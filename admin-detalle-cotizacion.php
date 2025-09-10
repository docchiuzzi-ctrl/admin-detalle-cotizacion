<?php
// DETALLE DE COTIZACIÓN - VERSIÓN CON LÓGICA DE REVISIONES
session_start();	

// Verificar permisos de administrador
if (!isset($_SESSION['nivel']) || $_SESSION['nivel'] < 10) {
    header('Location: login.php');
    exit;
}

require_once('Connections/db_config.php');

$cotizacion_id = intval($_GET['id'] ?? 0);
$mensaje = "";
$error = "";
$forzar_recalculo = isset($_GET['forzar_recalculo']) && $_GET['forzar_recalculo'] == '1';

// Verificar si hay mensaje de guardado desde la sesión
if (isset($_SESSION['mensaje_guardado'])) {
    $mensaje = $_SESSION['mensaje_guardado'];
    unset($_SESSION['mensaje_guardado']); // Limpiar mensaje después de mostrarlo
}

if (!$cotizacion_id) {
    header('Location: admin-cotizaciones.php');
    exit;
}

// Obtener tipo de cambio
$cambio_dolar = $_SESSION['CotizacionDolar'] ?? 1;

// Obtener ganancia mínima
try {
    $stmt = $conn->prepare("SELECT ImporteMinimo FROM datos LIMIT 1");
    $stmt->execute();
    $ganancia_minima_data = $stmt->fetch(PDO::FETCH_ASSOC);
    $ganancia_minima = ($ganancia_minima_data['ImporteMinimo'] ?? 0) * $cambio_dolar;
} catch (Exception $e) {
    $ganancia_minima = 0;
}

// Obtener datos de la cotización PRIMERO
try {
    $stmt = $conn->prepare("
        SELECT c.numero_cotizacion,
               c.fecha_solicitud,
               c.nombre,
               c.empresa,
               c.email,
               c.telefono,
               c.iva_incluido,
               c.comentarios,
               c.notas_respuesta,
               c.revision,
               COUNT(cd.id) as total_productos,
               SUM(cd.cantidad) as total_items
        FROM cotizaciones c 
        LEFT JOIN cotizaciones_detalle cd ON c.id = cd.cotizacion_id 
        WHERE c.id = ?
        GROUP BY c.id
    ");
    $stmt->execute([$cotizacion_id]);
    $cotizacion = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$cotizacion) {
        header('Location: admin-cotizaciones.php?error=Cotizacion no encontrada');
        exit;
    }
} catch (Exception $e) {
    header('Location: admin-cotizaciones.php?error=Error al cargar cotizacion');
    exit;
}

// ===== NUEVA LÓGICA: DECIDIR FUENTE DE DATOS =====
$usar_datos_procesados = ($cotizacion['revision'] >= 1) && !$forzar_recalculo;

// Obtener detalles de productos según la lógica
try {
    if ($usar_datos_procesados) {
        // ===== DATOS PROCESADOS - desde cotizaciones_detalle =====
        $stmt = $conn->prepare("
            SELECT cd.id as detalle_id,
                   cd.cantidad,
                   cd.precio_unitario,
                   cd.subtotal,
                   cd.comentarios_producto,
                   cd.variante_texto,
                   cd.item_id,
                   cd.variante_id,
                   cd.costo_producto,
                   cd.costo_moneda,
                   cd.costo_cambio,
                   cd.factura,
                   cd.metodo_id,
                   cd.metodo_impresion,
                   cd.sub_metodo_impresion,
                   cd.costo_impresion,
                   cd.costo_setup,
                   cd.costo_total,
                   cd.margen,
                   cd.precio_venta,
                   cd.importe_venta,
                   cd.ganancia,
                   cd.porcentaje_ganancia,
                   cd.nombre_producto as producto,
                   LPAD(cd.item_id, 5, '0') as codigo,
                   ia.stock,
                   cd.sale,
                   cd.imagen_producto as foto1,
				   items.it_obs_impresion
            FROM cotizaciones_detalle cd
			LEFT JOIN items ON items.item_id = cd.item_id
            LEFT JOIN items_atributos ia ON ia.item_atr = cd.variante_id
            WHERE cd.cotizacion_id = ?
            ORDER BY cd.id
        ");
        $stmt->execute([$cotizacion_id]);
        $productos = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        // Agregar campos calculados para compatibilidad
        foreach ($productos as $key => $prod) {
            $productos[$key]['it_costo'] = $prod['costo_producto'];
            $productos[$key]['it_precio_moneda'] = $prod['costo_moneda'];
        }
        unset($key, $prod); // Limpiar variables
        
    } else {
        // ===== DATOS FRESCOS - lógica original desde items =====
        $stmt = $conn->prepare("
            SELECT cd.id as detalle_id,
                   cd.cantidad,
                   cd.precio_unitario,
                   cd.subtotal,
				   case when cd.comentarios_producto = '' or isnull(cd.comentarios_producto) then i.it_obs_impresion
				        when cotizaciones.revision = 0 or isnull(cotizaciones.revision) then CONCAT(cd.comentarios_producto, '.' , i.it_obs_impresion)
				   end comentarios_producto, 
				   
                   cd.variante_texto,
                   cd.item_id,
                   cd.variante_id,
                   i.it_titulo as producto,
                   i.it_costo,
                   i.it_precio_moneda,
                   i.it_sale,
                   LPAD(i.item_id, 5, '0') as codigo,
                   ia.stock,
                   (SELECT file_name 
                    FROM galeria 
                    WHERE item_gal_id = LPAD(i.item_id, 5, '0') 
                    AND img_order = (SELECT MIN(img_order) 
                                    FROM galeria 
                                    WHERE item_gal_id = LPAD(i.item_id, 5, '0'))
                   ) as foto1
            FROM cotizaciones_detalle cd
			LEFT JOIN cotizaciones ON cotizaciones. id = cd.id
            LEFT JOIN items i ON cd.item_id = i.item_id
            LEFT JOIN items_atributos ia ON ia.item_atr = cd.variante_id
            WHERE cd.cotizacion_id = ?
            ORDER BY cd.id
        ");
        $stmt->execute([$cotizacion_id]);
        $productos = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        // Inicializar campos para datos frescos
        foreach ($productos as $key => $prod) {
            if ($forzar_recalculo) {
                // MODO RECÁLCULO: Conservar métodos existentes, resetear solo costos
                // Obtener métodos de la revisión actual para conservarlos
                try {
                    $stmt_metodos = $conn->prepare("
                        SELECT metodo_impresion, sub_metodo_impresion, margen, factura
                        FROM cotizaciones_detalle 
                        WHERE cotizacion_id = ? AND item_id = ? AND variante_id = ?
                        LIMIT 1
                    ");
                    $stmt_metodos->execute([$cotizacion_id, $prod['item_id'], $prod['variante_id']]);
                    $metodos_existentes = $stmt_metodos->fetch(PDO::FETCH_ASSOC);
                    
                    if ($metodos_existentes) {
                        $productos[$key]['metodo_impresion'] = $metodos_existentes['metodo_impresion'] ?? '';
                        $productos[$key]['sub_metodo_impresion'] = $metodos_existentes['sub_metodo_impresion'] ?? '';
                        $productos[$key]['margen'] = $metodos_existentes['margen'] ?? 1.30;
                        $productos[$key]['factura'] = $metodos_existentes['factura'] ?? 'S';
                    } else {
                        // Si no hay datos previos, usar valores por defecto
                        $productos[$key]['metodo_impresion'] = '';
                        $productos[$key]['sub_metodo_impresion'] = '';
                        $productos[$key]['margen'] = 1.30;
                        $productos[$key]['factura'] = 'S';
                    }
                } catch (Exception $e) {
                    // En caso de error, usar valores por defecto
                    $productos[$key]['metodo_impresion'] = '';
                    $productos[$key]['sub_metodo_impresion'] = '';
                    $productos[$key]['margen'] = 1.30;
                    $productos[$key]['factura'] = 'S';
                }
                
                // Resetear solo costos para que se recalculen
                $productos[$key]['costo_impresion'] = 0;
                $productos[$key]['costo_setup'] = 0;
                
            } else {
                // MODO PRIMERA VEZ: Todo vacío
                $productos[$key]['metodo_impresion'] = '';
                $productos[$key]['sub_metodo_impresion'] = '';
                $productos[$key]['costo_impresion'] = 0;
                $productos[$key]['costo_setup'] = 0;
                $productos[$key]['margen'] = 1.30;
                $productos[$key]['factura'] = 'S';
            }
        }
        unset($key, $prod); // Limpiar variables
    }
    
} catch (Exception $e) {
    $productos = [];
    $error = "Error al cargar productos: " . $e->getMessage();
}

// PROCESAR FORMULARIO PARA GUARDAR NUEVA COTIZACIÓN (con eliminación)
if ($_POST && isset($_POST['accion']) && $_POST['accion'] == 'guardar') {
    try {
        // Iniciar transacción
        $conn->beginTransaction();
        
        // 1. Obtener próxima revisión
        $stmt = $conn->prepare("SELECT COALESCE(MAX(revision), 0) + 1 as nueva_revision FROM cotizaciones WHERE numero_cotizacion = ?");
        $stmt->execute([$cotizacion['numero_cotizacion']]);
        $revision_data = $stmt->fetch(PDO::FETCH_ASSOC);
        $nueva_revision = $revision_data['nueva_revision'];
        
        // 2. Obtener datos editados del formulario (INCLUIR COMENTARIOS CLIENTE EDITADOS)
        $nombre_editado = trim($_POST['cliente_nombre'] ?? '');
        $empresa_editada = trim($_POST['cliente_empresa'] ?? '');
        $email_editado = trim($_POST['cliente_email'] ?? '');
        $telefono_editado = trim($_POST['cliente_telefono'] ?? '');
        $iva_incluido_editado = isset($_POST['iva_incluido']) ? 'S' : 'N';
        $comentarios_cliente_editados = trim($_POST['comentarios_cliente'] ?? '');
        $notas_respuesta_editadas = trim($_POST['notas_respuesta'] ?? '');
        
        // 3. Insertar nueva cotización con datos editados (USAR COMENTARIOS EDITADOS)
        $stmt = $conn->prepare("
            INSERT INTO cotizaciones (
                numero_cotizacion, nombre, empresa, email, telefono, iva_incluido,
                fecha_solicitud, fecha_respuesta, revision, userid,
				comentarios, notas_respuesta
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?)
        ");
        
        $stmt->execute([
            $cotizacion['numero_cotizacion'],
            $nombre_editado,
            $empresa_editada,
            $email_editado,
            $telefono_editado,
            $iva_incluido_editado,
            $cotizacion['fecha_solicitud'],
            $nueva_revision,
            $_SESSION['user_id'] ?? 1,
			$comentarios_cliente_editados,
            $notas_respuesta_editadas
        ]);
        
        $nueva_cotizacion_id = $conn->lastInsertId();
        
        // 4. Procesar productos del formulario (OMITIR productos marcados para eliminar)
        if (isset($_POST['productos']) && is_array($_POST['productos'])) {
            $productos_procesados = 0;
            $productos_eliminados = 0;
            
            foreach ($_POST['productos'] as $index => $producto_form) {
                // Verificar si está marcado para eliminar
                if (isset($producto_form['eliminar']) && $producto_form['eliminar'] == '1') {
                    $productos_eliminados++;
                    continue; // Saltar este producto
                }
                
                // Buscar datos originales del producto
                $producto_original = null;
                foreach ($productos as $prod) {
                    if ($prod['detalle_id'] == $producto_form['detalle_id']) {
                        $producto_original = $prod;
                        break;
                    }
                }
                
                if (!$producto_original) continue;
				
				// Validar métodos de impresión incompletos
					if (!empty($producto_form['metodo_impresion']) && empty($producto_form['sub_metodo'])) {
						throw new Exception("Producto '{$producto_original['producto']}': Si selecciona método de impresión debe seleccionar también el sub-método");
					}
                
                // Obtener metodo_id del sub-método seleccionado
                $metodo_id = null;
                if (!empty($producto_form['metodo_impresion']) && !empty($producto_form['sub_metodo'])) {
                    $stmt = $conn->prepare("
                        SELECT cp.precio_id 
                        FROM cotizador_metodos_precios cp
                        INNER JOIN cotizador_metodos_impresion cmi ON cp.metodo_id = cmi.metodo_id
                        WHERE cmi.metodo_nombre_carrito = ? AND cp.variante = ?
                    ");
                    $stmt->execute([$producto_form['metodo_impresion'], $producto_form['sub_metodo']]);
                    $metodo_data = $stmt->fetch(PDO::FETCH_ASSOC);
                    $metodo_id = $metodo_data['precio_id'] ?? null;
                }
                
                // Calcular valores del formulario
                $cantidad = floatval($producto_form['cantidad'] ?? 0);
                $costo_producto = floatval($producto_form['costo_producto'] ?? 0);
                $costo_impresion = floatval($producto_form['costo_impresion'] ?? 0);
                $costo_setup = floatval($producto_form['costo_setup'] ?? 0);
                $margen = floatval($producto_form['margen'] ?? 1.30);
                $factura = isset($producto_form['factura']) ? 'S' : 'N';
                
                // Calcular costo en pesos
                $moneda = $producto_form['moneda'] ?? 'AR$';
                 $costo_pesos = ($moneda === 'AR$') ? $costo_producto : ($costo_producto * $cambio_dolar);
                
                // Calcular totales (usar la misma lógica del JavaScript)
                $costo_total = $costo_pesos + $costo_impresion + ($cantidad > 0 ? $costo_setup / $cantidad : 0);
                $precio_venta = round($costo_total * $margen, 2);
                $importe_total = $precio_venta * $cantidad;
                
                // Calcular ganancia
                $ganancia_bruta = $importe_total - ($costo_total * $cantidad);
                if ($factura === 'S') {
                    $ganancia = $ganancia_bruta * 0.55;
                } else {
                    $ganancia = $ganancia_bruta + ($costo_total * $cantidad * 0.35);
                }
                
                $porcentaje_ganancia = $importe_total > 0 ? ($ganancia / $importe_total) * 100 : 0;
                
                // Obtener imagen del producto
                $imagen_producto = $producto_original['foto1'] ?? '';
                
                // Obtener comentarios editados del formulario
                $comentarios_producto = trim($producto_form['comentarios_producto'] ?? '');
                
                // Obtener información de oferta del producto original
                $sale_info = $producto_original['it_sale'] ?? '';
                
                // 5. Insertar detalle de producto
                $stmt = $conn->prepare("
                    INSERT INTO cotizaciones_detalle (
                        cotizacion_id, item_id, nombre_producto, cantidad, precio_unitario, subtotal,
                        imagen_producto, variante_id, variante_texto, costo_producto, costo_moneda,
                        costo_cambio, factura, metodo_id, metodo_impresion, sub_metodo_impresion,
                        costo_impresion, costo_setup, costo_total, margen, precio_venta,
                        importe_venta, ganancia, porcentaje_ganancia, comentarios_producto, sale
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ");
                
                $stmt->execute([
                    $nueva_cotizacion_id,
                    $producto_original['codigo'],
                    $producto_original['producto'],
                    $cantidad,
                    $precio_venta,
                    $importe_total,
                    $imagen_producto,
                    $producto_original['variante_id'],
                    $producto_original['variante_texto'],
                    $costo_producto,
                    $moneda,
                    $cambio_dolar,
                    $factura,
                    $metodo_id,
                    $producto_form['metodo_impresion'] ?? '',
                    $producto_form['sub_metodo'] ?? '',
                    $costo_impresion,
                    $costo_setup,
                    $costo_total,
                    $margen,
                    $precio_venta,
                    $importe_total,
                    $ganancia,
                    $porcentaje_ganancia,
                    $comentarios_producto,
                    $sale_info
                ]);
                
                $productos_procesados++;
            }
        }
        
        // Validar que no se eliminen todos los productos
        if ($productos_procesados == 0) {
            throw new Exception("Error: No se pueden eliminar todos los productos de la cotización. Debe mantener al menos 1 producto activo.");
        }
        
        // Confirmar transacción
        $conn->commit();
        
        // Crear mensaje de éxito con información de eliminación
        $mensaje_exito = "✅ Nueva cotización guardada exitosamente. Revisión #" . $nueva_revision . " - ID: " . $nueva_cotizacion_id;
        $mensaje_exito .= " (Productos procesados: {$productos_procesados}";
        
        if ($productos_eliminados > 0) {
            $mensaje_exito .= ", Productos eliminados: {$productos_eliminados}";
        }
        
        $mensaje_exito .= ")";
        $_SESSION['mensaje_guardado'] = $mensaje_exito;
        
        // Redirigir a la nueva cotización creada
        header('Location: admin-detalle-cotizacion.php?id=' . $nueva_cotizacion_id);
        exit;
        
    } catch (Exception $e) {
        // Revertir transacción en caso de error
        $conn->rollback();
        $error = "❌ Error al guardar cotización: " . $e->getMessage();
    }
}

// MANEJAR BOTÓN RECALCULAR
if ($_POST && isset($_POST['accion']) && $_POST['accion'] == 'calcular') {
    // Redirigir con parámetro para forzar recálculo
    header('Location: admin-detalle-cotizacion.php?id=' . $cotizacion_id . '&forzar_recalculo=1');
    exit;
}

// Función para calcular costo en pesos
function calcularCostoPesos($costo, $moneda, $cambio) {
    return $moneda === 'AR$' ? $costo : $costo * $cambio;
}

// Función para calcular totales de un producto
function calcularTotalesProducto($cantidad, $costo_pesos, $costo_impresion, $costo_setup, $margen, $factura) {
    $costo_total = $costo_pesos + $costo_impresion + ($costo_setup / $cantidad);
    $precio_venta = round($costo_total * $margen, 2);
    $importe_venta = $precio_venta * $cantidad;   
	
	if ($factura == 'S')
		{	
		$ganancia = ($importe_venta - ($costo_total * $cantidad)) * 0.55;		
		}
	else
		{
		$ganancia = ($importe_venta - ($costo_total * $cantidad));
		$ganancia = $ganancia + $ganancia  * 1.35;
		}
	
    $porcentaje_ganancia = $importe_venta > 0 ? ($ganancia / $importe_venta) * 100 : 0;
    
    return [
        'costo_total' => $costo_total,
        'precio_venta' => $precio_venta,
        'importe_venta' => $importe_venta,
        'ganancia' => $ganancia,
        'porcentaje_ganancia' => $porcentaje_ganancia
    ];
}

// Obtener datos de la empresa
try {
    $rs_datos = $conn->prepare("SELECT * FROM datos");
    $rs_datos->execute();
    $row_rs_datos = $rs_datos->fetch(PDO::FETCH_ASSOC);
    $site_title = $row_rs_datos['title'] ?? 'GMD Merchandising';
} catch (Exception $e) {
    $site_title = 'GMD Merchandising';
}
?>
<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>	
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Cotización #<?php echo htmlspecialchars($cotizacion['numero_cotizacion'] . ' - Revisión # ' . $cotizacion['revision']); ?> - <?php echo $site_title; ?></title>
    
    <link href="boilerplate.css" rel="stylesheet" type="text/css">
    <link href="stylesheet.css" rel="stylesheet" type="text/css">
    <link rel="stylesheet" href="css/menu-styles.css">
    <link rel="stylesheet" type="text/css" href="textos-botones.css">
    <link rel="stylesheet" type="text/css" href="admin-detalle-cotizacion.css">
</head>
<body>
    <?php include("header.php");?>
	
    <div id="slidertop"></div>
    
    <div id="grid-Container">
        <div id="cuerpo">
            <div class="productos-destacados" id="titulossite" style="text-align: center; color: #3c609f;">
                📋 Gestión de Cotizaciones
            </div>
            
            <div id="contenido">
                <div class="cotizacion-container">
                    
                    <?php if ($mensaje): ?>
                        <div class="mensaje">✅ <?php echo $mensaje; ?></div>
                    <?php endif; ?>
                    
                    <?php if ($error): ?>
                        <div class="error">❌ <?php echo $error; ?></div>
                    <?php endif; ?>

                    <!-- INDICADOR DE MODO -->
                    <?php if ($usar_datos_procesados): ?>
                        <div style="background: #e8f4fd; padding: 10px; border-radius: 5px; margin-bottom: 20px; border-left: 4px solid #3c609f;">
                            📊 <strong>Modo: Datos Procesados</strong> - Mostrando costos y precios ya calculados de esta revisión.
                            <a href="?id=<?php echo $cotizacion_id; ?>&forzar_recalculo=1" style="margin-left: 15px; color: #3c609f;">🔄 Recalcular desde datos frescos</a>
                        </div>
                    <?php elseif ($forzar_recalculo): ?>
                        <div style="background: #fff3cd; padding: 10px; border-radius: 5px; margin-bottom: 20px; border-left: 4px solid #ffc107;">
                            🔄 <strong>Modo: Recálculo Inteligente</strong> - Conservando métodos seleccionados, actualizando costos desde base de datos.
                        </div>
                    <?php else: ?>
                        <div style="background: #fff3cd; padding: 10px; border-radius: 5px; margin-bottom: 20px; border-left: 4px solid #ffc107;">
                            🆕 <strong>Modo: Datos Frescos</strong> - Calculando costos desde base de datos actualizada.
                        </div>
                    <?php endif; ?>
                    
                    <!-- HEADER PRINCIPAL -->
                    <div class="header-cotizacion">
                        <div>
                            <div class="titulo-grande">
                                📋 Cotización #<?php echo htmlspecialchars($cotizacion['numero_cotizacion'] . ' - Revisión # ' . $cotizacion['revision']); ?>
                            </div>                            
							<div style="margin-top: 5px; opacity: 0.9;">
                                Solicitada el <?php echo date('d/m/Y', strtotime($cotizacion['fecha_solicitud'])); ?>
                            </div>
                        </div>
                        
                        <div style="text-align: right;">
                            <div style="font-size: 14px; opacity: 0.9;">Tipo de cambio</div>
                            <div style="font-size: 20px; font-weight: bold;">
                                $<?php 
                                if ($usar_datos_procesados && !empty($productos[0]['costo_cambio'])) {
                                    echo number_format($productos[0]['costo_cambio'], 2);
                                } else {
                                    echo number_format($cambio_dolar, 2);
                                }
                                ?>
                            </div>
                        </div>
                    </div>
                    
                    <!-- FORMULARIO DE PRODUCTOS -->
                    <form method="post" action="">
                        <input type="hidden" name="cotizacion_id" value="<?php echo $cotizacion_id; ?>">
                        <!-- Campo para pasar info al JavaScript -->
                        <input type="hidden" id="usar_datos_procesados" value="<?php echo $usar_datos_procesados ? '1' : '0'; ?>">
                        <input type="hidden" id="revision_actual" value="<?php echo $cotizacion['revision']; ?>">
                        <input type="hidden" id="forzar_recalculo" value="<?php echo $forzar_recalculo ? '1' : '0'; ?>">
                        
                        <!-- INFORMACIÓN GENERAL -->
						<div class="info-grid">
							<div class="info-card">
								<h3>👤 Información del Cliente</h3>
								<div class="info-row">
									<span class="info-label">Nombre:</span>
									<input type="text" name="cliente_nombre" value="<?php echo htmlspecialchars($cotizacion['nombre']); ?>" class="info-input">
								</div>
								<div class="info-row">
									<span class="info-label">Empresa:</span>
									<input type="text" name="cliente_empresa" value="<?php echo htmlspecialchars($cotizacion['empresa']); ?>" class="info-input">
								</div>
								<div class="info-row">
									<span class="info-label">Email:</span>
									<input type="email" name="cliente_email" value="<?php echo htmlspecialchars($cotizacion['email']); ?>" class="info-input">
								</div>
								<div class="info-row">
									<span class="info-label">Teléfono:</span>
									<input type="text" name="cliente_telefono" value="<?php echo htmlspecialchars($cotizacion['telefono']); ?>" class="info-input">
								</div>
								<div class="info-row">
									<span class="info-label">IVA Incluido:</span>
									<input type="checkbox" name="iva_incluido" value="S" <?php echo (($cotizacion['iva_incluido'] ?? 'N') == 'S') ? 'checked' : ''; ?>>
								</div>								
							</div>
							
							<div class="info-card">
								<label for="comentarios_cliente" style="display: block; font-weight: bold; font-size: 14px; color: #3c609f; margin-bottom: 8px;">
									💬 Comentarios del Cliente (Editable):
								</label>
								<textarea name="comentarios_cliente" id="comentarios_cliente" 
										  style="width: 100%; min-height: 100px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; font-family: inherit; resize: vertical; background: white; color: #333; transition: border-color 0.3s ease;"
										  placeholder="Comentarios del cliente..."><?php echo htmlspecialchars($cotizacion['comentarios'] ?? ''); ?></textarea>
								
								<div style="margin-top: 15px;">
									<label for="notas_respuesta" style="display: block; font-weight: bold; font-size: 14px; color: #3c609f; margin-bottom: 8px;">
										📝 Comentarios Cotización:
									</label>
									<textarea name="notas_respuesta" id="notas_respuesta" 
											  style="width: 100%; min-height: 80px; padding: 10px; border: 1px solid #3c609f; border-radius: 4px; font-size: 14px; font-family: inherit; resize: vertical; background: white; color: #333; transition: border-color 0.3s ease;"
											  placeholder="Agregar notas internas de la cotización..."><?php echo htmlspecialchars($cotizacion['notas_respuesta'] ?? ''); ?></textarea>
								</div>
							</div>
						</div>
												
                        <div class="productos-form">
                            <div class="producto-header">
                                🛒 Detalle de Cotización
                            </div>
                            
                            <?php if (empty($productos)): ?>
                                <div style="text-align: center; padding: 40px; color: #666;">
                                    No hay productos en esta cotización
                                </div>
                            <?php else: ?>
                                <?php foreach ($productos as $index => $prod): ?>
                                    <div class="producto-item">
                                        <input type="hidden" name="productos[<?php echo $index; ?>][detalle_id]" value="<?php echo $prod['detalle_id']; ?>">
                                        <input type="hidden" name="productos[<?php echo $index; ?>][item_id]" value="<?php echo $prod['item_id']; ?>">
                                        <input type="hidden" name="productos[<?php echo $index; ?>][moneda]"  value="<?php echo htmlspecialchars($prod['it_precio_moneda'] ?? $prod['costo_moneda'] ?? 'AR$');?>">
										<input type="hidden" name="productos[<?php echo $index; ?>][sale]" value="<?php echo htmlspecialchars($prod['it_sale'] ?? $prod['sale'] ?? ''); ?>">
                                        
                                        <!-- INFORMACIÓN BÁSICA DEL PRODUCTO -->
										<div class="producto-info">
											<!-- IMAGEN DEL PRODUCTO CON LINK -->
											<div class="producto-img-area">
												<?php if ($prod['foto1'] && file_exists($prod['foto1'])): ?>
													<a href="https://gmd.com.ar/detalle-item.php?item_id=<?php echo htmlspecialchars($prod['codigo']); ?>" 
													   target="_blank" class="producto-img-link" title="Ver producto">
														<img src="<?php echo htmlspecialchars($prod['foto1']); ?>" 
															 alt="<?php echo htmlspecialchars($prod['producto']); ?>" 
															 class="producto-img">
													</a>
												<?php else: ?>
													<a href="https://gmd.com.ar/detalle-item.php?item_id=<?php echo htmlspecialchars($prod['codigo']); ?>" 
													   target="_blank" class="producto-img-link" title="Ver producto">
														<div style="width: 70px; height: 70px; background: #f0f0f0; display: flex; align-items: center; justify-content: center; border-radius: 8px; font-size: 12px; color: #999;">
															Sin imagen
														</div>
													</a>
												<?php endif; ?>
											</div>
											
											<!-- DETALLES DEL PRODUCTO -->
											<div class="producto-detalles">
												<!-- LÍNEA PRINCIPAL: CÓDIGO + NOMBRE + MÉTODO -->
												<div class="producto-linea-principal">
													<!-- CÓDIGO DEL PRODUCTO CON CHECKBOX ELIMINACIÓN -->
													
													<!-- Checkbox eliminación -->
														<label class="eliminar-producto-checkbox">
															<input type="checkbox" name="productos[<?php echo $index; ?>][eliminar]" value="1">
															<span class="eliminar-icono">🗑️</span>
															<span class="eliminar-texto">Eliminar</span>
														</label>														
													
													<div class="producto-codigo-area">
														<a href="https://gmd.com.ar/detalle-item.php?item_id=<?php echo htmlspecialchars($prod['codigo']); ?>" 
														   target="_blank" class="producto-codigo">
															#<?php echo htmlspecialchars($prod['codigo']); ?>
														</a>														
														
													</div>
													
													<!-- NOMBRE Y MÉTODO DE IMPRESIÓN CON LINK -->
													<div class="producto-nombre-metodo-area">
														<div class="producto-nombre">
															<a href="https://gmd.com.ar/detalle-item.php?item_id=<?php echo htmlspecialchars($prod['codigo']); ?>" 
															   target="_blank" class="producto-nombre-link">
																<?php echo htmlspecialchars($prod['producto'] ?? 'Producto no encontrado'); ?>
																<?php if ($prod['variante_texto']): ?>
																	<span class="producto-variante">- <?php echo htmlspecialchars($prod['variante_texto']); ?></span>
																<?php endif; ?>
															</a>
														</div>
														
														<!-- MOSTRAR MÉTODO DE IMPRESIÓN SI EXISTE -->
														<?php if (!empty($prod['metodo_impresion']) || !empty($prod['sub_metodo_impresion'])): ?>
															<div class="producto-metodo-impresion">
																<?php 
																$metodo_texto = '';
																if (!empty($prod['metodo_impresion'])) {
																	$metodo_texto = $prod['metodo_impresion'];
																	if (!empty($prod['sub_metodo_impresion'])) {
																		$metodo_texto .= ' - ' . $prod['sub_metodo_impresion'];
																	}
																}
																echo htmlspecialchars($metodo_texto);
																?>
															</div>
														<?php endif; ?>													
														
														
													</div>
												</div>
												
												<!-- ÁREA DE COMENTARIOS DEBAJO DEL CÓDIGO -->
												<div class="producto-comentarios-area">
													<label for="comentarios_<?php echo $index; ?>" class="comentarios-label">💬 Comentarios/Personalización:</label>
													<textarea name="productos[<?php echo $index; ?>][comentarios_producto]" 
															  id="comentarios_<?php echo $index; ?>"
															  class="comentarios-textarea"
															  placeholder="Agregar comentarios o detalles de personalización..."><?php echo htmlspecialchars($prod['comentarios_producto'] ?? ''); ?></textarea>
												</div>												
												
												
											</div>
											
											<!-- INFORMACIÓN DE STOCK Y OFERTAS -->
											<div class="producto-stock-area">
												<?php 
												$stock = $prod['stock'] ?? 0;
												$clase_stock = $stock <= 0 ? 'stock-sin' : ($stock < 10 ? 'stock-bajo' : 'stock-ok');
												?>
												<span class="stock-info <?php echo $clase_stock; ?>">
													Stock: <?php echo $stock; ?>
												</span>
												
												<!-- INFORMACIÓN DE OFERTAS -->
												<?php
												// Usar lógica condicional según el modo
												if ($usar_datos_procesados) {
													$sale = $prod['sale'] ?? '';        // Histórico guardado
												} else {
													$sale = $prod['it_sale'] ?? '';     // Actual del item
												}
												
												if ($sale === 'SI') {
													echo '<div style="color: red; font-weight: bold; font-size: 12px; margin-top: 5px;">⚠️ Precio rebajado</div>';
												} elseif ($sale !== '' && $sale !== 'NO') {
													echo '<div style="color: red; font-weight: bold; font-size: 12px; margin-top: 5px;">⚠️ Promo ' . htmlspecialchars($sale) . '% Off</div>';
												}
												?>
											</div>
										</div>									
									                                        
                                        <!-- CAMPOS DE EDICIÓN -->
                                        <div class="campos-edicion">
                                            <!-- COSTOS BÁSICOS -->
                                            <div class="campo-grupo">
                                                <label class="campo-label">Moneda</label>
                                                <input type="text" class="campo-input campo-readonly" 
                                                       value="<?php echo htmlspecialchars($prod['it_precio_moneda'] ?? $prod['costo_moneda'] ?? 'AR$'); ?>" readonly>
                                            </div>
                                            
                                            <div class="campo-grupo">
                                                <label class="campo-label">Costo</label>
                                                <input type="text" class="campo-input campo-editable campo-calculadora" 
													   name="productos[<?php echo $index; ?>][costo_producto]"
													   value="<?php echo $prod['it_costo'] ?? $prod['costo_producto'] ?? 0; ?>"
													   placeholder="Ej: 10+5 o 15*1.2">
											</div>
                                            
                                            <div class="campo-grupo">
                                                <label class="campo-label">Costo en Pesos</label>
                                                <?php 
                                                $moneda_producto = $prod['it_precio_moneda'] ?? $prod['costo_moneda'] ?? 'AR$';
                                                $costo_original = $prod['it_costo'] ?? $prod['costo_producto'] ?? 0;
                                                
                                                // Usar cambio histórico en datos procesados
                                                if ($usar_datos_procesados && !empty($prod['costo_cambio'])) {
                                                    $cambio_a_usar = $prod['costo_cambio'];
                                                } else {
                                                    $cambio_a_usar = $cambio_dolar;
                                                }
                                                
                                                $costo_pesos = calcularCostoPesos($costo_original, $moneda_producto, $cambio_a_usar);
                                                ?>
                                                <input type="text" class="campo-input campo-readonly" 
                                                       name="productos[<?php echo $index; ?>][costo_pesos_display]"
                                                       value="$<?php echo number_format($costo_pesos, 2); ?>" readonly>
                                            </div>
                                            
                                            <!-- CANTIDAD Y OPCIONES -->
                                            <div class="campo-grupo">
                                                <label class="campo-label">Cantidad</label>
                                                <input type="number" min="1" class="campo-input campo-editable" 
                                                       name="productos[<?php echo $index; ?>][cantidad]"
                                                       value="<?php echo $prod['cantidad']; ?>">
                                            </div>
                                            
                                            <div class="campo-grupo">
                                                <label class="campo-label">Factura</label>
                                                <input type="checkbox" class="campo-editable" style="width: auto; margin: 5px auto; display: block;"
                                                       name="productos[<?php echo $index; ?>][factura]" 
                                                       value="S" <?php echo (($prod['factura'] ?? 'S') == 'S') ? 'checked' : ''; ?>>
                                            </div>
                                            
                                            <!-- MÉTODOS DE IMPRESIÓN -->
                                            <div class="campo-grupo">
                                                <label class="campo-label">Método de Impresión</label>
                                                <select class="campo-input campo-editable" name="productos[<?php echo $index; ?>][metodo_impresion]">
                                                    <option value="">Seleccionar método...</option>
                                                    <?php 
                                                    // Obtener métodos de impresión para este producto específico
                                                    try {
                                                        $stmt = $conn->prepare("SELECT DISTINCT metodo_nombre_carrito
                                                                                FROM item_ad_impresion_grupos INNER JOIN cotizador_metodos_grupos ON
                                                                                            cotizador_metodos_grupos.grupo_id = item_ad_impresion_grupos.grupo_id
                                                                                                          INNER JOIN cotizador_metodos_grupos_detalle ON
                                                                                             cotizador_metodos_grupos_detalle.grupo_id = item_ad_impresion_grupos.grupo_id
                                                                                                          INNER JOIN cotizador_metodos_impresion ON
                                                                                              cotizador_metodos_impresion.metodo_id = cotizador_metodos_grupos_detalle.metodo_id
                                                                                where item_ad_impresion_grupos.item_id = ?
                                                                                ORDER BY metodo_nombre_carrito");
                                                        $stmt->execute([$prod['item_id']]);
                                                        $totalRows = $stmt->rowCount();
                                                        $metodos_impresion_producto = $stmt->fetchAll(PDO::FETCH_ASSOC);
                                                        
                                                        if ($totalRows == 0) {
                                                            $stmt = $conn->prepare("SELECT DISTINCT metodo_nombre_carrito FROM cotizador_metodos_impresion ORDER BY metodo_nombre_carrito");
                                                            $stmt->execute();
                                                            $metodos_impresion_producto = $stmt->fetchAll(PDO::FETCH_ASSOC);
                                                        }
                                                    } catch (Exception $e) {
                                                        $metodos_impresion_producto = [];
                                                    }
                                                    
                                                    foreach ($metodos_impresion_producto as $metodo): 
                                                        $selected = ($metodo['metodo_nombre_carrito'] == ($prod['metodo_impresion'] ?? '')) ? 'selected' : '';
                                                    ?>
                                                        <option value="<?php echo htmlspecialchars($metodo['metodo_nombre_carrito']); ?>" <?php echo $selected; ?>>
                                                            <?php echo htmlspecialchars($metodo['metodo_nombre_carrito']); ?>
                                                        </option>
                                                    <?php endforeach; ?>
                                                </select>
                                            </div>
                                            
                                            <div class="campo-grupo">
                                                <label class="campo-label">Sub-método</label>
                                                <select class="campo-input campo-editable" name="productos[<?php echo $index; ?>][sub_metodo]">
                                                    <option value="">Primero seleccione método</option>
                                                    <?php if (!empty($prod['sub_metodo_impresion'])): ?>
                                                        <option value="<?php echo htmlspecialchars($prod['sub_metodo_impresion']); ?>" selected>
                                                            <?php echo htmlspecialchars($prod['sub_metodo_impresion']); ?>
                                                        </option>
                                                    <?php endif; ?>
                                                </select>
                                            </div>
                                            
                                            <div class="campo-grupo">
                                                <label class="campo-label">Costo Impresión</label>
                                                <input type="number" step="0.01" class="campo-input campo-editable" 
                                                       name="productos[<?php echo $index; ?>][costo_impresion]"
                                                       value="<?php echo number_format($prod['costo_impresion'] ?? 0, 2, '.', ''); ?>" placeholder="0.00">
                                            </div>
                                            
                                            <div class="campo-grupo">
                                                <label class="campo-label">Costo Setup</label>
                                                <input type="number" step="0.01" class="campo-input campo-editable" 
                                                       name="productos[<?php echo $index; ?>][costo_setup]"
                                                       value="<?php echo number_format($prod['costo_setup'] ?? 0, 2, '.', ''); ?>" placeholder="0.00">
                                            </div>
                                            
                                            <!-- MARGEN Y PRECIOS -->
                                            <div class="campo-grupo">
                                                <label class="campo-label">Margen</label>
                                                <input type="number" step="0.01" min="1" class="campo-input campo-editable" 
                                                       name="productos[<?php echo $index; ?>][margen]"
                                                       value="<?php echo number_format($prod['margen'] ?? 1.30, 2, '.', ''); ?>">
                                            </div>
                                        </div>
                                        
                                        <!-- RESULTADOS CALCULADOS -->
                                        <?php
                                        if ($usar_datos_procesados) {
                                            // Usar valores ya calculados de la base de datos
                                            $costo_total_calc = $prod['costo_total'] ?? 0;
                                            $precio_venta_calc = $prod['precio_venta'] ?? 0;
                                            $importe_venta_calc = $prod['importe_venta'] ?? 0;
                                            $ganancia_calc = $prod['ganancia'] ?? 0;
                                            $porcentaje_ganancia_calc = $prod['porcentaje_ganancia'] ?? 0;
                                        } else {
                                            // Calcular ejemplo con valores por defecto
                                            $cantidad = $prod['cantidad'];
                                            $costo_impresion = $prod['costo_impresion'] ?? 0;
                                            $costo_setup = $prod['costo_setup'] ?? 0;
                                            $margen = $prod['margen'] ?? 1.30;
                                            $factura = $prod['factura'] ?? 'S';
                                            
                                            $totales = calcularTotalesProducto($cantidad, $costo_pesos, $costo_impresion, $costo_setup, $margen, $factura);
                                            $costo_total_calc = $totales['costo_total'];
                                            $precio_venta_calc = $totales['precio_venta'];
                                            $importe_venta_calc = $totales['importe_venta'];
                                            $ganancia_calc = $totales['ganancia'];
                                            $porcentaje_ganancia_calc = $totales['porcentaje_ganancia'];
                                        }
                                        ?>
                                        
                                        <div class="resultados-calculo">
                                            <div class="resultado-row">
                                                <span>Costo Total:</span>
                                                <span>$<?php echo number_format($costo_total_calc, 2); ?></span>
                                            </div>
                                            <div class="resultado-row">
                                                <span>Precio Venta:</span>
                                                <span>$<?php echo number_format($precio_venta_calc, 2); ?></span>
                                            </div>
                                            <div class="resultado-row">
                                                <span>Importe Total:</span>
                                                <span>$<?php echo number_format($importe_venta_calc, 2); ?></span>
                                            </div>
                                            <div class="resultado-row">
                                                <span>Ganancia:</span>
                                                <span>$<?php echo number_format($ganancia_calc, 2); ?></span>
                                            </div>
                                            <div class="resultado-row resultado-total">
                                                <span>% Ganancia:</span>
                                                <span><?php echo number_format($porcentaje_ganancia_calc, 2); ?>%</span>
                                            </div>                                            
                                        </div>
                                    </div>
                                <?php endforeach; ?>
                            <?php endif; ?>
                        </div>
                        
                        <!-- ACCIONES -->
                        <div class="acciones-footer">
							<button type="submit" name="accion" value="calcular" class="btn btn-success">🔄 Recalcular Cotización</button>
							<button type="submit" name="accion" value="guardar" class="btn btn-primary" onclick="return confirmarGuardar()">💾 Guardar Revisión</button>
							
							<a href="generar-pdf-cotizacion.php?id=<?php echo $cotizacion_id; ?>" class="btn btn-primary" target="_blank" title="Generar PDF">📄 Generar PDF</a>
							<a href="admin-cotizaciones.php" class="btn btn-secondary">← Volver al Listado</a>
							
						</div>
                    </form>
                    
                </div>
            </div>
        </div>
    </div>
    
    <?php include("footer.php"); ?>
    
    <!-- Variables JavaScript -->
    <script>
        window.cambio_dolar = <?php echo number_format($cambio_dolar, 2, '.', ''); ?>;
        window.ganancia_minima = <?php echo $ganancia_minima; ?>;
        window.usar_datos_procesados = <?php echo $usar_datos_procesados ? 'true' : 'false'; ?>;
        window.revision_actual = <?php echo $cotizacion['revision']; ?>;
        window.forzar_recalculo = <?php echo $forzar_recalculo ? 'true' : 'false'; ?>;
    </script>
    
    <!-- Scripts externos -->
    <script src="admin-detalle-cotizacion-scripts.js"></script>
    
</body>
</html>