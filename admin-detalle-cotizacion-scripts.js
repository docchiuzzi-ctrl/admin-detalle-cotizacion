// ===== ADMIN DETALLE COTIZACIÓN - SCRIPTS CON LÓGICA DE REVISIONES =====

// ===== FUNCIONES AJAX PARA SUB-MÉTODOS Y COSTOS =====

// Función para cargar sub-métodos via AJAX
function cargarSubmetodos(selectMetodo, indexProducto) {
    var metodoSeleccionado = selectMetodo.value;
    var selectSubmetodo = document.querySelector('select[name="productos[' + indexProducto + '][sub_metodo]"]');
    
    console.log('Cargando sub-métodos para:', metodoSeleccionado);
    
    // Limpiar sub-métodos y costos SIEMPRE
    selectSubmetodo.innerHTML = '<option value="">Cargando...</option>';
    limpiarCostos(indexProducto);
    
    if (!metodoSeleccionado) {
        console.log('❌ Método deseleccionado - Limpiando costos y recalculando');
        selectSubmetodo.innerHTML = '<option value="">Primero seleccione método</option>';
        
        // NUEVO: Recalcular después de limpiar costos
        setTimeout(() => {
            recalcularProducto(indexProducto);
        }, 100);
        return;
    }
    
    // Crear FormData para el POST
    var formData = new FormData();
    formData.append('metodo', metodoSeleccionado);
    
    // Hacer petición AJAX
    fetch('ajax/obtener_sub_metodos.php', {
        method: 'POST',
        body: formData
    })
    .then(function(response) {
        if (!response.ok) {
            throw new Error('HTTP ' + response.status + ': ' + response.statusText);
        }
        return response.json();
    })
    .then(function(submetodos) {
        console.log('Sub-métodos recibidos:', submetodos);
        
        // Limpiar y cargar sub-métodos
        selectSubmetodo.innerHTML = '<option value="">Seleccione sub-método...</option>';
        
        if (submetodos.error) {
            console.error('Error del servidor:', submetodos.error);
            selectSubmetodo.innerHTML = '<option value="">Error: ' + submetodos.error + '</option>';
            return;
        }
        
        if (Array.isArray(submetodos) && submetodos.length > 0) {
            submetodos.forEach(function(submetodo) {
                var option = document.createElement('option');
                option.value = submetodo.variante;
                
                // Mostrar información adicional si está disponible
                var texto = submetodo.variante;
                if (submetodo.cantidad_min && submetodo.cantidad_max) {
                    texto += ' (Cant: ' + submetodo.cantidad_min + '-' + submetodo.cantidad_max + ')';
                }
                
                option.textContent = texto;
                selectSubmetodo.appendChild(option);
            });
            
            console.log('Cargados ' + submetodos.length + ' sub-métodos');
        } else {
            selectSubmetodo.innerHTML = '<option value="">No hay sub-métodos disponibles</option>';
            console.warn('No se encontraron sub-métodos para:', metodoSeleccionado);
        }
        
        // NUEVO: Recalcular después de cargar sub-métodos (sin costos de impresión)
        setTimeout(() => {
            recalcularProducto(indexProducto);
        }, 100);
    })
    .catch(function(error) {
        console.error('Error cargando sub-métodos:', error);
        selectSubmetodo.innerHTML = '<option value="">Error de conexión</option>';
        
        // Mostrar error más detallado en consola
        if (error.name === 'SyntaxError') {
            console.error('El servidor no devolvió JSON válido. Posible error PHP.');
        }
        
        // NUEVO: Recalcular incluso con error
        setTimeout(() => {
            recalcularProducto(indexProducto);
        }, 100);
    });
}

// Función para cargar costos de impresión
function cargarCostosImpresion(indexProducto) {
    var metodo = document.querySelector('select[name="productos[' + indexProducto + '][metodo_impresion]"]').value;
    var subMetodo = document.querySelector('select[name="productos[' + indexProducto + '][sub_metodo]"]').value;
    var cantidad = parseInt(document.querySelector('input[name="productos[' + indexProducto + '][cantidad]"]').value) || 0;
    
    var inputCostoImpresion = document.querySelector('input[name="productos[' + indexProducto + '][costo_impresion]"]');
    var inputCostoSetup = document.querySelector('input[name="productos[' + indexProducto + '][costo_setup]"]');
    
    console.log('Cargando costos - Método:', metodo, 'Sub-método:', subMetodo, 'Cantidad:', cantidad);
    
    if (!metodo || !subMetodo || !cantidad || cantidad <= 0) {
        console.warn('Parámetros insuficientes para cargar costos');
        limpiarCostos(indexProducto);
        return;
    }
    
    // Mostrar "Cargando..."
    inputCostoImpresion.value = 'Cargando...';
    inputCostoSetup.value = 'Cargando...';
    
    // Crear FormData para el POST
    var formData = new FormData();
    formData.append('metodo', metodo);
    formData.append('sub_metodo', subMetodo);
    formData.append('cantidad', cantidad);
    
    // Hacer petición AJAX
    fetch('ajax/obtener_costos_impresion.php', {
        method: 'POST',
        body: formData
    })
    .then(function(response) {
        if (!response.ok) {
            throw new Error('HTTP ' + response.status + ': ' + response.statusText);
        }
        return response.json();
    })
    .then(function(costos) {
        console.log('Costos recibidos:', costos);
        
        // Calcular costo de impresión ajustado por cantidad mínima
        let costoImpresionFinal = parseFloat(costos.costo_impresion || 0);
        
        // Si hay cantidad mínima y la cantidad ingresada es menor
        if (costos.cantidad_minima && cantidad < costos.cantidad_minima) {
            // Costo Impresión = (cantidad_minima × precio_unitario) ÷ cantidad_ingresada
            costoImpresionFinal = (costos.cantidad_minima * costoImpresionFinal) / cantidad;
            
            console.log('Cantidad menor al mínimo:', {
                cantidadIngresada: cantidad,
                cantidadMinima: costos.cantidad_minima,
                costoOriginal: parseFloat(costos.costo_impresion || 0),
                costoAjustado: costoImpresionFinal
            });
        }
        
        // Aplicar costos
        inputCostoImpresion.value = costoImpresionFinal.toFixed(2);
        inputCostoSetup.value = parseFloat(costos.costo_setup || 0).toFixed(2);
        
        // Mostrar información de debug si está disponible
        if (costos.debug) {
            console.log('Debug info:', costos.debug);
        }
        
        // Mostrar advertencias si las hay
        if (costos.error) {
            console.warn('Advertencia:', costos.error);
            mostrarAdvertencia(indexProducto, costos.error);
        } else {
            // Limpiar advertencias previas
            limpiarAdvertencias(indexProducto);
        }
        
        // Mostrar información sobre ajuste de cantidad mínima
        if (costos.cantidad_minima && cantidad < costos.cantidad_minima) {
            const mensajeMinimo = `Cantidad ingresada (${cantidad}) es menor al mínimo de Impresión (${costos.cantidad_minima}). Costo de Impresión ajustado automáticamente.`;
            mostrarAdvertencia(indexProducto, mensajeMinimo);
        }
        
        console.log('Costos aplicados - Impresión: $' + inputCostoImpresion.value + ', Setup: $' + inputCostoSetup.value);
        
        // Recálculo automático después de cargar costos
        recalcularProducto(indexProducto);
    })
    .catch(function(error) {
        console.error('Error cargando costos:', error);
        inputCostoImpresion.value = '0.00';
        inputCostoSetup.value = '0.00';
        
        // Mostrar error al usuario
        mostrarAdvertencia(indexProducto, 'Error de conexión al cargar costos');
        
        if (error.name === 'SyntaxError') {
            console.error('El servidor no devolvió JSON válido. Revisar logs PHP.');
        }
    });
}

// ===== FUNCIONES DE UTILIDAD =====

// Función para limpiar costos
function limpiarCostos(indexProducto) {
    console.log('🧹 Limpiando costos para producto:', indexProducto);
    
    const inputCostoImpresion = document.querySelector('input[name="productos[' + indexProducto + '][costo_impresion]"]');
    const inputCostoSetup = document.querySelector('input[name="productos[' + indexProducto + '][costo_setup]"]');
    
    if (inputCostoImpresion) {
        inputCostoImpresion.value = '0.00';
        console.log('✅ Costo impresión limpiado');
    }
    
    if (inputCostoSetup) {
        inputCostoSetup.value = '0.00';
        console.log('✅ Costo setup limpiado');
    }
    
    limpiarAdvertencias(indexProducto);
    
    // NUEVO: Auto-recalcular después de limpiar costos
    console.log('🔄 Programando recálculo automático...');
    setTimeout(() => {
        recalcularProducto(indexProducto);
    }, 50);
}

// Función para mostrar advertencias al usuario
function mostrarAdvertencia(indexProducto, mensaje) {
    var productoItem = document.querySelector('input[name="productos[' + indexProducto + '][detalle_id]"]').closest('.producto-item');
    
    // Remover advertencias previas
    var advertenciaPrevia = productoItem.querySelector('.advertencia-costos');
    if (advertenciaPrevia) {
        advertenciaPrevia.remove();
    }
    
    // Crear nueva advertencia
    var advertencia = document.createElement('div');
    advertencia.className = 'advertencia-costos';
    advertencia.innerHTML = '⚠️ <strong>Advertencia:</strong> ' + mensaje;

    
    // Insertar después de los campos de edición
    var camposEdicion = productoItem.querySelector('.campos-edicion');
    camposEdicion.parentNode.insertBefore(advertencia, camposEdicion.nextSibling);
}

// Función para limpiar advertencias
function limpiarAdvertencias(indexProducto) {
    var productoItem = document.querySelector('input[name="productos[' + indexProducto + '][detalle_id]"]').closest('.producto-item');
    var advertencia = productoItem.querySelector('.advertencia-costos');
    if (advertencia) {
        advertencia.remove();
    }
}

// Función para verificar stock dinámicamente
function verificarStock(index, cantidad, stock, productoItem) {
    console.log('verificarStock ejecutándose - Cantidad:', cantidad, 'Stock:', stock);
    
    // Remover advertencia previa de stock dinámico
    const alertaPrevia = productoItem.querySelector('.alerta-stock-dinamica');
    if (alertaPrevia) {
        alertaPrevia.remove();
    }
    
    if (cantidad > stock) {
        console.log('Stock insuficiente detectado, creando alerta...');
        const alerta = document.createElement('div');
        alerta.className = 'alerta-stock-dinamica';
        alerta.innerHTML = `⌧ Cantidad solicitada (${cantidad}) supera el stock disponible (${stock})`;
        
        // Insertar después de la última advertencia existente o después de resultados
        const ultimaAdvertencia = productoItem.querySelector('.alerta-ganancia-dinamica') || 
                                 productoItem.querySelector('.advertencia-costos') ||
                                 productoItem.querySelector('.resultados-calculo');
        ultimaAdvertencia.parentNode.insertBefore(alerta, ultimaAdvertencia.nextSibling);
        console.log('Alerta de stock insertada correctamente');
    } else {
        console.log('Stock suficiente, no se muestra alerta');
    }
}

// Función para test de conexión
function testearConexionAjax() {
    console.log('Testeando conexión AJAX...');
    
    fetch('ajax/obtener_sub_metodos.php', {
        method: 'POST',
        body: new FormData()
    })
    .then(response => response.json())
    .then(data => {
        console.log('Conexión AJAX funcionando. Respuesta:', data);
    })
    .catch(error => {
        console.error('Error de conexión AJAX:', error);
    });
}

// ===== FUNCIONES DE CÁLCULO =====

// Función para formatear números con separadores de miles
function formatearNumero(numero) {
    if (isNaN(numero) || numero === null || numero === undefined) {
        return '0,00';
    }
    return parseFloat(numero).toLocaleString('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// Función para actualizar costo en pesos
function actualizarCostoPesos(index) {
    const costo = parseFloat(document.querySelector('input[name="productos[' + index + '][costo_producto]"]').value) || 0;
    const moneda = document.querySelector('input[name="productos[' + index + '][moneda]"]').value || 'AR$';
    
    const costoPesos = moneda === 'US$' ? costo * window.cambio_dolar : costo;
    
    const campoCostoPesos = document.querySelector('input[name="productos[' + index + '][costo_pesos_display]"]');
    if (campoCostoPesos) {
        campoCostoPesos.value = '$' + costoPesos.toFixed(2);
    }
}

// Función de recálculo automático
function recalcularProducto(index) {
    try {
        const costo = parseFloat(document.querySelector('input[name="productos[' + index + '][costo_producto]"]').value) || 0;
        const cantidad = parseInt(document.querySelector('input[name="productos[' + index + '][cantidad]"]').value) || 1;
        const costoImp = parseFloat(document.querySelector('input[name="productos[' + index + '][costo_impresion]"]').value) || 0;
        const costoSetup = parseFloat(document.querySelector('input[name="productos[' + index + '][costo_setup]"]').value) || 0;
        const margen = parseFloat(document.querySelector('input[name="productos[' + index + '][margen]"]').value) || 1.30;
        const moneda = document.querySelector('input[name="productos[' + index + '][moneda]"]') ? document.querySelector('input[name="productos[' + index + '][moneda]"]').value : 'AR$';
        const factura = document.querySelector('input[name="productos[' + index + '][factura]"]').checked ? 'S' : 'N';
        
        const costoPesos = moneda === 'AR$' ? costo : costo * window.cambio_dolar;
        const costoTotal = costoPesos + costoImp + (cantidad > 0 ? costoSetup / cantidad : 0);
        const precioVenta = ((costoTotal * margen) * 100 / 100).toFixed(2);
        const importeTotal = precioVenta * cantidad;
        const factorGanancia = factura === 'S' ? 0.55 : 1.035;
        const gananciabruta = (importeTotal - (costoTotal * cantidad));
		const ganancia = factura === 'S' ? gananciabruta * 0.55 : gananciabruta + costoTotal * cantidad * 0.35;
        const porcentaje = importeTotal > 0 ? (ganancia / importeTotal) * 100 : 0;
        
        // Actualizar los campos de resultado
        const productoItem = document.querySelectorAll('.producto-item')[index];
        if (productoItem) {
            const spans = productoItem.querySelectorAll('.resultado-row span:last-child');
            if (spans[0]) spans[0].textContent = '$' + formatearNumero(costoTotal);
            if (spans[1]) spans[1].textContent = '$' + formatearNumero(precioVenta);
            if (spans[2]) spans[2].textContent = '$' + formatearNumero(importeTotal);
            if (spans[3]) spans[3].textContent = '$' + formatearNumero(ganancia);
            if (spans[4]) spans[4].textContent = formatearNumero(porcentaje) + '%';
            
            // Obtener stock del elemento .stock-info
            const stockElement = productoItem.querySelector('.stock-info');
            const stockText = stockElement ? stockElement.textContent.trim() : '';
            const stock = parseInt(stockText.replace('Stock:', '').trim()) || 0;
            
            console.log('DEBUG Stock - Cantidad:', cantidad, 'Stock:', stock, 'Elemento encontrado:', stockElement, 'Texto:', stockText);
            
            // Efecto visual
            const resultadosDiv = productoItem.querySelector('.resultados-calculo');
            if (resultadosDiv) {
                resultadosDiv.style.background = '#d4edda';
                setTimeout(() => {
                    resultadosDiv.style.background = '#e8f4fd';
                }, 500);
            }
            
            // Verificar alertas de ganancia mínima
            verificarGananciaMinima(index, ganancia, importeTotal, productoItem);
            
            // Verificar stock dinámicamente
            verificarStock(index, cantidad, stock, productoItem);
        }
    } catch (error) {
        console.log('Error en recálculo:', error);
    }
}

// Función para verificar ganancia mínima
function verificarGananciaMinima(index, ganancia, importeTotal, productoItem) {
    // Remover alertas previas de ganancia
    const alertaPrevia = productoItem.querySelector('.alerta-ganancia-dinamica');
    if (alertaPrevia) {
        alertaPrevia.remove();
    }
    
    if (importeTotal < window.ganancia_minima && window.ganancia_minima > 0) {
        const margen = parseFloat(document.querySelector('input[name="productos[' + index + '][margen]"]').value) || 1.30;
        const margenSugerido = (window.ganancia_minima * margen) / importeTotal + 0.01;
        
        const alerta = document.createElement('div');
        alerta.className = 'alerta-ganancia alerta-ganancia-dinamica';
        alerta.innerHTML = `
            ⚠️ <strong>Venta inferior al mínimo</strong><br>
                Venta actual: ${formatearNumero(importeTotal)} - Mínimo requerido: ${formatearNumero(window.ganancia_minima)} - Margen sugerido: ${formatearNumero(margenSugerido)}    
             `;
        
        const resultadosDiv = productoItem.querySelector('.resultados-calculo');
        resultadosDiv.parentNode.insertBefore(alerta, resultadosDiv.nextSibling);
    }
}

// ===== FUNCIONES NUEVAS PARA CALCULADORA AUTOMÁTICA =====

// Función para evaluar expresiones matemáticas de forma segura
function evaluarExpresion(expresion) {
    console.log('🧮 Evaluando expresión:', expresion);
    
    try {
        // Limpiar la expresión (solo números, operadores básicos, puntos, espacios y paréntesis)
        let expresionLimpia = expresion.replace(/[^0-9+\-*/.() ]/g, '');
        console.log('✨ Expresión limpia:', expresionLimpia);
        
        // Validar que no esté vacía después de limpiar
        if (!expresionLimpia) {
            console.log('❌ Expresión vacía después de limpiar');
            return null;
        }
        
        // Validaciones adicionales de seguridad
        if (expresionLimpia.length > 50) {
            console.log('❌ Expresión demasiado larga');
            return null;
        }
        
        // Verificar paréntesis balanceados
        let parentesis = 0;
        for (let char of expresionLimpia) {
            if (char === '(') parentesis++;
            if (char === ')') parentesis--;
            if (parentesis < 0) {
                console.log('❌ Paréntesis no balanceados');
                return null;
            }
        }
        if (parentesis !== 0) {
            console.log('❌ Paréntesis no balanceados');
            return null;
        }
        
        // Verificar que no haya operadores consecutivos
        if (/[+\-*/]{2,}/.test(expresionLimpia)) {
            console.log('❌ Operadores consecutivos detectados');
            return null;
        }
        
        // Verificar que no termine en operador
        if (/[+\-*/]$/.test(expresionLimpia)) {
            console.log('❌ Expresión termina en operador');
            return null;
        }
        
        // Remover + inicial si existe (ej: "+1+2" -> "1+2")
        expresionLimpia = expresionLimpia.replace(/^\+/, '');
        console.log('🔧 Sin + inicial:', expresionLimpia);
        
        // Validar que contenga al menos un operador o sea un número válido
        if (/[+\-*/]/.test(expresionLimpia) || /^\d*\.?\d+$/.test(expresionLimpia)) {
            console.log('✅ Expresión válida, evaluando...');
            
            // Evaluar la expresión de forma segura
            const resultado = Function('"use strict"; return (' + expresionLimpia + ')')();
            console.log('🎯 Resultado crudo:', resultado);
            
            // Verificar que el resultado sea un número finito y positivo
            if (isFinite(resultado) && !isNaN(resultado) && resultado >= 0) {
                console.log('✅ Resultado válido:', resultado);
                return resultado;
            } else {
                console.log('❌ Resultado no es un número válido o es negativo');
                return null;
            }
        } else {
            console.log('❌ No contiene operadores válidos ni es número válido');
            return null;
        }
    } catch (e) {
        console.log('❌ Error en evaluación:', e.message);
        return null;
    }
}

// Función para validar entrada en tiempo real
function validarEntradaCosto(input) {
    let valor = input.value;
    let cursorPos = input.selectionStart;
    
    // Permitir solo números, operadores básicos, puntos y paréntesis
    let valorLimpio = valor.replace(/[^0-9+\-*/.() ]/g, '');
    
    // Si el valor cambió, actualizarlo y restaurar cursor
    if (valor !== valorLimpio) {
        input.value = valorLimpio;
        // Ajustar posición del cursor
        let nuevaPos = Math.min(cursorPos, valorLimpio.length);
        input.setSelectionRange(nuevaPos, nuevaPos);
    }
    
    // Validar longitud máxima
    if (input.value.length > 50) {
        input.value = input.value.substring(0, 50);
    }
}

// Configurar calculadora automática ESPECÍFICAMENTE para campos de costo
function configurarCalculadoraAutomatica() {
    // Seleccionar específicamente los campos de costo
    const camposCosto = document.querySelectorAll('input[name*="[costo_producto]"]');
    
    console.log('🧮 Configurando calculadora para', camposCosto.length, 'campos de costo');
    
    camposCosto.forEach(function(campo, index) {
        console.log('⚙️ Configurando campo', index, ':', campo.name);
        
        // Agregar clase para identificación
        campo.classList.add('campo-calculadora');
        
        // Validación en tiempo real mientras se escribe
        campo.addEventListener('input', function(e) {
            validarEntradaCosto(this);
        });
        
        // Prevenir pegar contenido inválido
        campo.addEventListener('paste', function(e) {
            e.preventDefault();
            let pasteData = (e.clipboardData || window.clipboardData).getData('text');
            
            // Limpiar datos pegados
            let datosLimpios = pasteData.replace(/[^0-9+\-*/.() ]/g, '');
            
            if (datosLimpios.length > 0 && datosLimpios.length <= 50) {
                // Insertar en la posición del cursor
                let inicio = this.selectionStart;
                let fin = this.selectionEnd;
                let valorActual = this.value;
                
                this.value = valorActual.substring(0, inicio) + datosLimpios + valorActual.substring(fin);
                
                // Posicionar cursor después del texto pegado
                let nuevaPos = inicio + datosLimpios.length;
                this.setSelectionRange(nuevaPos, nuevaPos);
            }
        });
        
        // Event listener para Enter
        campo.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevenir submit del form
                
                const valor = this.value.trim();
                console.log('🔢 Evento Enter - Campo:', this.name, 'Valor:', valor);
                
                // Solo evaluar si hay algo que calcular
                if (valor && valor !== '') {
                    const resultado = evaluarExpresion(valor);
                    console.log('📊 Resultado evaluación:', resultado);
                    
                    if (resultado !== null) {
                        const valorFormateado = resultado.toFixed(2);
                        console.log('✅ Aplicando resultado:', valorFormateado);
                        
                        // Actualizar el valor
                        this.value = valorFormateado;
                        
                        // Obtener índice del producto para recálculos
                        const match = this.name.match(/\[(\d+)\]/);
                        if (match) {
                            const productoIndex = parseInt(match[1]);
                            console.log('🔄 Recalculando producto:', productoIndex);
                            
                            // Actualizar costo en pesos
                            actualizarCostoPesos(productoIndex);
                            
                            // Recalcular totales
                            setTimeout(() => {
                                recalcularProducto(productoIndex);
                            }, 100);
                        }
                        
                        // Mostrar feedback visual de éxito
                        this.style.backgroundColor = '#d4edda';
                        this.style.borderColor = '#c3e6cb';
                        setTimeout(() => {
                            this.style.backgroundColor = '';
                            this.style.borderColor = '';
                        }, 1500);
                        
                    } else {
                        console.log('❌ No se pudo evaluar la expresión');
                        // Mostrar feedback de error
                        this.style.backgroundColor = '#f8d7da';
                        this.style.borderColor = '#f5c6cb';
                        setTimeout(() => {
                            this.style.backgroundColor = '';
                            this.style.borderColor = '';
                        }, 2000);
                        
                        // Mostrar mensaje de error específico
                        mostrarMensajeError(this, 'Expresión inválida. Use solo números y operadores (+, -, *, /, paréntesis)');
                    }
                } else {
                    console.log('⚠️ Campo vacío, no hay nada que calcular');
                }
            }
            
            // Prevenir caracteres inválidos directamente
            if (!/[0-9+\-*/.() ]/.test(e.key) && 
                !['Backspace', 'Delete', 'Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) &&
                !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
            }
        });
        
        // Event listener para blur (cuando sale del campo) como alternativa
        campo.addEventListener('blur', function() {
            const valor = this.value.trim();
            
            // Validar que si hay contenido, sea válido
            if (valor) {
                // Si es solo un número, verificar que sea válido
                if (/^\d*\.?\d+$/.test(valor)) {
                    const numero = parseFloat(valor);
                    if (numero >= 0) {
                        this.value = numero.toFixed(2);
                        
                        // Recálculos
                        const match = this.name.match(/\[(\d+)\]/);
                        if (match) {
                            const productoIndex = parseInt(match[1]);
                            actualizarCostoPesos(productoIndex);
                            setTimeout(() => {
                                recalcularProducto(productoIndex);
                            }, 100);
                        }
                    } else {
                        this.value = '0.00';
                        mostrarMensajeError(this, 'El costo no puede ser negativo');
                    }
                }
                // Si contiene operadores, auto-calcular
                else if (/[+\-*/]/.test(valor)) {
                    console.log('🔍 Auto-cálculo en blur - Campo:', this.name, 'Valor:', valor);
                    
                    const resultado = evaluarExpresion(valor);
                    if (resultado !== null) {
                        const valorFormateado = resultado.toFixed(2);
                        console.log('✅ Auto-aplicando resultado:', valorFormateado);
                        
                        this.value = valorFormateado;
                        
                        // Recálculos
                        const match = this.name.match(/\[(\d+)\]/);
                        if (match) {
                            const productoIndex = parseInt(match[1]);
                            actualizarCostoPesos(productoIndex);
                            setTimeout(() => {
                                recalcularProducto(productoIndex);
                            }, 100);
                        }
                    } else {
                        // Si no se puede evaluar, limpiar o poner valor por defecto
                        this.value = '0.00';
                        mostrarMensajeError(this, 'Expresión inválida, se estableció costo en 0');
                    }
                }
            } else {
                // Si está vacío, poner 0
                this.value = '0.00';
            }
        });
        
        // Agregar tooltip de ayuda mejorado
        campo.title = "💡 Calculadora: Escriba operaciones como 10+5, 15*1.2, (10+5)*2 y presione Enter\n⚠️ Solo se permiten números y operadores matemáticos";
    });
    
    console.log('🎯 Calculadora configurada exitosamente');
}

// Función para mostrar mensajes de error temporales
function mostrarMensajeError(campo, mensaje) {
    // Remover mensaje previo si existe
    const mensajePrevio = campo.parentNode.querySelector('.mensaje-error-calculadora');
    if (mensajePrevio) {
        mensajePrevio.remove();
    }
    
    // Crear nuevo mensaje
    const mensajeDiv = document.createElement('div');
    mensajeDiv.className = 'mensaje-error-calculadora';
    mensajeDiv.style.cssText = `
        color: #721c24;
        background-color: #f8d7da;
        border: 1px solid #f5c6cb;
        border-radius: 3px;
        padding: 5px 8px;
        font-size: 12px;
        margin-top: 3px;
        position: absolute;
        z-index: 1000;
        max-width: 250px;
    `;
    mensajeDiv.textContent = mensaje;
    
    // Insertar después del campo
    campo.parentNode.style.position = 'relative';
    campo.parentNode.appendChild(mensajeDiv);
    
    // Remover después de 3 segundos
    setTimeout(() => {
        if (mensajeDiv.parentNode) {
            mensajeDiv.remove();
        }
    }, 3000);
}

// ===== FUNCIONALIDAD DE ELIMINACIÓN DE PRODUCTOS =====

// Función para configurar eliminación de productos
function configurarEliminacionProductos() {
    console.log('Configurando eliminación de productos...');
    
    const checkboxesEliminar = document.querySelectorAll('input[name*="[eliminar]"]');
    
    checkboxesEliminar.forEach(function(checkbox, index) {
        checkbox.addEventListener('change', function() {
            const productoItem = this.closest('.producto-item');
            const match = this.name.match(/\[(\d+)\]/);
            const productoIndex = match ? parseInt(match[1]) : index;
            
            if (this.checked) {
                // Confirmar eliminación
                const nombreProducto = productoItem.querySelector('.producto-nombre-link').textContent.trim();
                const confirmar = confirm(`¿Está seguro que desea marcar para eliminar el producto:\n\n"${nombreProducto}"\n\nEste producto no se incluirá en la nueva revisión de la cotización.`);
                
                if (confirmar) {
                    marcarProductoParaEliminacion(productoItem, productoIndex, true);
                } else {
                    this.checked = false;
                }
            } else {
                marcarProductoParaEliminacion(productoItem, productoIndex, false);
            }
            
            // Actualizar contador de productos activos
            actualizarContadorProductos();
        });
    });
    
    console.log(`Configurados ${checkboxesEliminar.length} checkboxes de eliminación`);
}

// Función para marcar/desmarcar producto para eliminación
function marcarProductoParaEliminacion(productoItem, index, eliminar) {
    if (eliminar) {
        productoItem.classList.add('marcado-eliminacion');
        console.log(`Producto ${index} marcado para eliminación`);
        
        // Mostrar mensaje de confirmación
        mostrarMensajeEliminacion(productoItem, true);
    } else {
        productoItem.classList.remove('marcado-eliminacion');
        console.log(`Producto ${index} desmarcado para eliminación`);
        
        // Ocultar mensaje de confirmación
        mostrarMensajeEliminacion(productoItem, false);
        
        // Recalcular el producto al desmarcarlo
        setTimeout(() => {
            recalcularProducto(index);
        }, 100);
    }
}

// Función para mostrar/ocultar mensaje de eliminación
function mostrarMensajeEliminacion(productoItem, mostrar) {
    let mensajeExistente = productoItem.querySelector('.confirmacion-eliminacion');
    
    if (mostrar) {
        if (!mensajeExistente) {
            const mensaje = document.createElement('div');
            mensaje.className = 'confirmacion-eliminacion mostrar';
            mensaje.innerHTML = `
                <span class="icono-advertencia">⚠️</span>
                <span>Este producto será eliminado de la cotización al guardar la nueva revisión</span>
            `;
            
            // Insertar después de los resultados de cálculo
            const resultados = productoItem.querySelector('.resultados-calculo');
            if (resultados) {
                resultados.parentNode.insertBefore(mensaje, resultados.nextSibling);
            }
        }
    } else {
        if (mensajeExistente) {
            mensajeExistente.remove();
        }
    }
}

// Función para actualizar contador de productos activos
function actualizarContadorProductos() {
    const totalProductos = document.querySelectorAll('.producto-item').length;
    const productosEliminados = document.querySelectorAll('.producto-item.marcado-eliminacion').length;
    const productosActivos = totalProductos - productosEliminados;
    
    // Remover contador previo si existe
    const contadorPrevio = document.querySelector('.contador-eliminados');
    if (contadorPrevio) {
        contadorPrevio.remove();
    }
    
    // Mostrar contador solo si hay productos eliminados
    if (productosEliminados > 0) {
        const contador = document.createElement('div');
        contador.className = 'contador-eliminados';
        contador.innerHTML = `
            🗑️ <strong>${productosEliminados}</strong> producto(s) marcado(s) para eliminación. 
            <strong>${productosActivos}</strong> producto(s) se incluirán en la nueva revisión.
        `;
        
        // Insertar antes del formulario de productos
        const productosForm = document.querySelector('.productos-form');
        if (productosForm) {
            productosForm.parentNode.insertBefore(contador, productosForm);
        }
    }
    
    console.log(`Contador actualizado: ${productosEliminados} eliminados, ${productosActivos} activos`);
}

// Modificar función de recálculo para excluir productos eliminados
const recalcularProductoOriginal = window.recalcularProducto || recalcularProducto;

function recalcularProductoModificado(index) {
    // Verificar si el producto está marcado para eliminación
    const productoItem = document.querySelectorAll('.producto-item')[index];
    if (productoItem && productoItem.classList.contains('marcado-eliminacion')) {
        // No recalcular productos marcados para eliminación
        console.log(`Saltando recálculo para producto ${index} - marcado para eliminación`);
        return;
    }
    
    // Llamar función original de recálculo
    return recalcularProducto(index);
}

// Validar que no se eliminen todos los productos
function validarEliminacionCompleta() {
    const totalProductos = document.querySelectorAll('.producto-item').length;
    const productosEliminados = document.querySelectorAll('.producto-item.marcado-eliminacion').length;
    
    if (productosEliminados >= totalProductos) {
        alert('Error: No puede eliminar todos los productos de la cotización.\n\nDebe mantener al menos 1 producto activo.');
        return false;
    }
    
    return true;
}

// Función para confirmar antes de guardar (MODIFICADA)
function confirmarGuardar() {
    // Validar que no se eliminen todos los productos
    if (!validarEliminacionCompleta()) {
        return false;
    }
    
    const totalProductos = document.querySelectorAll('.producto-item').length;
    const productosEliminados = document.querySelectorAll('.producto-item.marcado-eliminacion').length;
    const productosActivos = totalProductos - productosEliminados;
    const cotizacionNum = document.querySelector('.titulo-grande').textContent.match(/#(\S+)/)?.[1] || 'N/A';
    
    let mensaje = `¿Está seguro que desea guardar una nueva revisión de la cotización ${cotizacionNum}?\n\n`;
    mensaje += `Se procesarán ${productosActivos} productos`;
    
    if (productosEliminados > 0) {
        mensaje += ` (${productosEliminados} productos serán eliminados)`;
    }
    
    mensaje += ' con los valores actuales del formulario.';
    
    return confirm(mensaje);
}

// ===== INICIALIZACIÓN CON LÓGICA DE REVISIONES =====

// Configurar event listeners cuando cargue la página
document.addEventListener('DOMContentLoaded', function() {
    console.log('Inicializando sistema de costos dinámico...');
    
    // ===== DETECTAR MODO DE OPERACIÓN =====
    const usarDatosProcesados = window.usar_datos_procesados || false;
    const revisionActual = window.revision_actual || 0;
    const forzarRecalculo = window.forzar_recalculo || false;
    
    console.log('Modo detectado:', {
        usarDatosProcesados: usarDatosProcesados,
        revisionActual: revisionActual,
        forzarRecalculo: forzarRecalculo
    });
    
    // ===== VALIDACIONES Y CÁLCULOS SEGÚN EL MODO =====
    if (usarDatosProcesados) {
        console.log('📄 MODO: Datos Procesados - Cargando valores ya calculados...');
        
        // 1. NO calcular automáticamente - usar valores de la BD
        console.log('Saltando cálculos automáticos - usando datos procesados');
        
        // 2. Cargar sub-métodos para métodos ya seleccionados
        setTimeout(function() {
            cargarSubmetodosExistentes();
        }, 500);
        
        // 3. Validar stocks iniciales solamente
        setTimeout(function() {
            validarTodosLosStocksAlCargar();
        }, 800);
        
    } else if (forzarRecalculo) {
        console.log('🔄 MODO: Recálculo Inteligente - Conservando métodos, actualizando costos...');
        
        // 1. Cargar sub-métodos para métodos conservados
        setTimeout(function() {
            cargarSubmetodosExistentes();
        }, 500);
        
        // 2. Auto-cargar costos para métodos ya seleccionados
        setTimeout(function() {
            recalcularConMetodosExistentes();
        }, 1000);
        
        // 3. Validar stocks
        setTimeout(function() {
            validarTodosLosStocksAlCargar();
        }, 1500);
        
    } else {
        console.log('🆕 MODO: Datos Frescos - Calculando desde cero...');
        
        // 1. Calcular todos los productos al cargar (lógica original)
        setTimeout(function() {
            calcularTodosLosProductosAlCargar();
        }, 500);
        
        // 2. Validar stocks iniciales
        setTimeout(function() {
            validarTodosLosStocksAlCargar();
        }, 800);
    }
    
    // Testear conexión
    testearConexionAjax();
    
    var metodosSelects = document.querySelectorAll('select[name*="[metodo_impresion]"]');
    var submetodosSelects = document.querySelectorAll('select[name*="[sub_metodo]"]');
    var cantidadInputs = document.querySelectorAll('input[name*="[cantidad]"]');
    
    console.log('Elementos encontrados:', {
        metodos: metodosSelects.length,
        submetodos: submetodosSelects.length,
        cantidades: cantidadInputs.length
    });
    
    // Event listeners para métodos
    metodosSelects.forEach(function(select, index) {
        select.addEventListener('change', function() {
            console.log('🔧 Método cambiado:', this.value, 'para producto', index);
            
            // Si se deselecciona el método (valor vacío)
            if (!this.value || this.value === '') {
                console.log('❌ Método deseleccionado - limpiando sub-método y costos');
                
                // Limpiar sub-método
                const selectSubmetodo = document.querySelector('select[name="productos[' + index + '][sub_metodo]"]');
                if (selectSubmetodo) {
                    selectSubmetodo.innerHTML = '<option value="">Primero seleccione método</option>';
                }
                
                // Limpiar costos y recalcular
                limpiarCostos(index);
            } else {
                // Método seleccionado, cargar sub-métodos
                console.log('✅ Método seleccionado:', this.value);
                cargarSubmetodos(this, index);
            }
        });
    });
    
    // Event listeners para sub-métodos
    submetodosSelects.forEach(function(select, index) {
        select.addEventListener('change', function() {
            console.log('🔧 Sub-método cambiado:', this.value, 'para producto', index);
            
            // Si se deselecciona el sub-método
            if (!this.value || this.value === '') {
                console.log('❌ Sub-método deseleccionado - limpiando costos');
                limpiarCostos(index);
            } else {
                // Sub-método seleccionado, cargar costos
                console.log('✅ Sub-método seleccionado:', this.value);
                cargarCostosImpresion(index);
            }
        });
    });
    
    // Event listeners para cantidad (también afecta el costo)
    cantidadInputs.forEach(function(input, index) {
        input.addEventListener('change', function() {
            console.log('Cantidad cambiada a:', this.value, 'para producto', index);
            // Solo cargar costos si ya hay método y sub-método seleccionados
            var metodo = document.querySelector('select[name="productos[' + index + '][metodo_impresion]"]').value;
            var subMetodo = document.querySelector('select[name="productos[' + index + '][sub_metodo]"]').value;
            
            if (metodo && subMetodo) {
                cargarCostosImpresion(index);
            }
        });
    });
    
    // Configurar eliminación de productos
    setTimeout(function() {
        configurarEliminacionProductos();
    }, 1200);
    
    // Configurar recálculo automático después de un breve delay
    setTimeout(function() {
        configurarRecalculoAutomatico();
    }, 1000);
    
    console.log('Sistema de sub-métodos y costos dinámico cargado completamente');
});

// ===== NUEVAS FUNCIONES PARA MANEJO DE REVISIONES =====

// Función para recálculo inteligente conservando métodos
function recalcularConMetodosExistentes() {
    console.log('🔄 Recalculando con métodos existentes conservados...');
    
    const productos = document.querySelectorAll('.producto-item');
    let productosConMetodos = 0;
    
    productos.forEach(function(producto, index) {
        const metodoSelect = producto.querySelector(`select[name="productos[${index}][metodo_impresion]"]`);
        const subMetodoSelect = producto.querySelector(`select[name="productos[${index}][sub_metodo]"]`);
        
        const metodo = metodoSelect ? metodoSelect.value : '';
        const subMetodo = subMetodoSelect ? subMetodoSelect.value : '';
        
        console.log(`Producto ${index}: Método='${metodo}', Sub-método='${subMetodo}'`);
        
        if (metodo && subMetodo) {
            productosConMetodos++;
            // Auto-cargar costos para métodos ya seleccionados con delay escalonado
            setTimeout(() => {
                console.log(`Cargando costos para producto ${index}...`);
                cargarCostosImpresion(index);
            }, index * 300); // 300ms entre cada producto para evitar sobrecarga
        } else if (metodo && !subMetodo) {
            // Si solo hay método, cargar sub-métodos
            setTimeout(() => {
                console.log(`Cargando sub-métodos para producto ${index}...`);
                cargarSubmetodos(metodoSelect, index);
            }, index * 200);        
        } else {
            // Si no hay métodos, solo recalcular con valores básicos
            setTimeout(() => {
                actualizarCostoPesos(index);
                recalcularProducto(index);
            }, index * 100);
        }
    });
    
    console.log(`Productos con métodos completos: ${productosConMetodos}/${productos.length}`);
    
    // Mensaje informativo
    if (productosConMetodos > 0) {
        setTimeout(() => {
            console.log('✅ Recálculo inteligente completado - Métodos conservados, costos actualizados');
        }, productos.length * 300 + 1000);
    }
}

// Función para cargar sub-métodos de métodos ya seleccionados (datos procesados)
function cargarSubmetodosExistentes() {
    console.log('Cargando sub-métodos para métodos ya seleccionados...');
    
    const metodosSelects = document.querySelectorAll('select[name*="[metodo_impresion]"]');
    
    metodosSelects.forEach(function(select, index) {
        const metodoSeleccionado = select.value;
        const submetodoSelect = document.querySelector('select[name="productos[' + index + '][sub_metodo]"]');
        const submetodoActual = submetodoSelect.querySelector('option[selected]');
        
        if (metodoSeleccionado && submetodoActual) {
            console.log(`Cargando sub-métodos para producto ${index}, método: ${metodoSeleccionado}`);
            
            // Crear FormData para el POST
            var formData = new FormData();
            formData.append('metodo', metodoSeleccionado);
            
            // Hacer petición AJAX
            fetch('ajax/obtener_sub_metodos.php', {
                method: 'POST',
                body: formData
            })
            .then(function(response) {
                return response.json();
            })
            .then(function(submetodos) {
                // Limpiar opciones actuales excepto la seleccionada
                const valorSeleccionado = submetodoActual.value;
                submetodoSelect.innerHTML = '<option value="">Seleccione sub-método...</option>';
                
                if (Array.isArray(submetodos) && submetodos.length > 0) {
                    submetodos.forEach(function(submetodo) {
                        var option = document.createElement('option');
                        option.value = submetodo.variante;
                        option.textContent = submetodo.variante;
                        
                        // Mantener seleccionado el sub-método actual
                        if (submetodo.variante === valorSeleccionado) {
                            option.selected = true;
                        }
                        
                        submetodoSelect.appendChild(option);
                    });
                    
                    console.log(`Sub-métodos cargados para producto ${index}`);
                }
            })
            .catch(function(error) {
                console.error(`Error cargando sub-métodos para producto ${index}:`, error);
            });
        } else if (metodoSeleccionado && !submetodoActual) {
            // Si hay método pero no sub-método, cargar opciones
            console.log(`Cargando sub-métodos para método ${metodoSeleccionado} en producto ${index}`);
            cargarSubmetodos(select, index);
        }
    });
}

// ===== FUNCIONES PARA INICIALIZACIÓN =====

// Función para calcular todos los productos al cargar la página (solo modo datos frescos)
function calcularTodosLosProductosAlCargar() {
    console.log('Calculando todos los productos al cargar...');
    
    const productos = document.querySelectorAll('.producto-item');
    productos.forEach(function(producto, index) {
        // Actualizar costo en pesos
        actualizarCostoPesos(index);
        
        // Recalcular totales
        recalcularProducto(index);
    });
    
    console.log(`Calculados ${productos.length} productos al cargar`);
}

// Función para validar todos los stocks al cargar
function validarTodosLosStocksAlCargar() {
    console.log('Validando stocks al cargar...');
    
    const productos = document.querySelectorAll('.producto-item');
    productos.forEach(function(producto, index) {
        const cantidadInput = producto.querySelector(`input[name="productos[${index}][cantidad]"]`);
        const stockElement = producto.querySelector('.stock-info');
        
        if (cantidadInput && stockElement) {
            const cantidad = parseInt(cantidadInput.value) || 0;
            const stockText = stockElement.textContent.trim();
            const stock = parseInt(stockText.replace('Stock:', '').trim()) || 0;
            
            // Usar la función existente de verificación de stock
            verificarStock(index, cantidad, stock, producto);
        }
    });
    
    console.log(`Validados stocks de ${productos.length} productos al cargar`);
}

// Función para configurar recálculo automático
function configurarRecalculoAutomatico() {
    const campos = document.querySelectorAll('input[name*="[costo_producto]"], input[name*="[cantidad]"], input[name*="[costo_impresion]"], input[name*="[costo_setup]"], input[name*="[margen]"], input[name*="[factura]"]');
    
    campos.forEach(function(input) {
        const match = input.name.match(/\[(\d+)\]/);
        if (match) {
            const index = parseInt(match[1]);
            
            // Para campos numéricos, usar input con delay
            if (input.type === 'number') {
                input.addEventListener('input', function() {
                    clearTimeout(this._timeout);
                    this._timeout = setTimeout(() => {
                        // Si es el campo de costo, también actualizar el costo en pesos
                        if (input.name.includes('[costo_producto]')) {
                            actualizarCostoPesos(index);
                        }
                        recalcularProducto(index);
                    }, 300);
                });
            }
            
            // Para todos los campos, usar change para actualizaciones inmediatas
            input.addEventListener('change', function() {
                // Si es el campo de costo, también actualizar el costo en pesos
                if (input.name.includes('[costo_producto]')) {
                    actualizarCostoPesos(index);
                }
                recalcularProducto(index);
            });
        }
    });
    
    // Inicializar costos en pesos para todos los productos (solo si no es datos procesados)
    if (!window.usar_datos_procesados) {
        const camposCosto = document.querySelectorAll('input[name*="[costo_producto]"]');
        camposCosto.forEach(function(input) {
            const match = input.name.match(/\[(\d+)\]/);
            if (match) {
                const index = parseInt(match[1]);
                actualizarCostoPesos(index);
            }
        });
    }
    
    console.log('Recálculo automático configurado para', campos.length, 'campos');
    configurarCalculadoraAutomatica();
}

// ===== FUNCIONES ADICIONALES =====

// Función para validar formulario antes del envío
function validarFormulario() {
    let errores = [];
    
    const productos = document.querySelectorAll('.producto-item');
    productos.forEach(function(producto, index) {
        const cantidad = producto.querySelector('input[name*="[cantidad]"]').value;
        const margen = producto.querySelector('input[name*="[margen]"]').value;
        
        if (!cantidad || cantidad <= 0) {
            errores.push(`Producto ${index + 1}: La cantidad debe ser mayor a 0`);
        }
        
        if (!margen || margen < 1) {
            errores.push(`Producto ${index + 1}: El margen debe ser mayor o igual a 1`);
        }
    });
    
    if (errores.length > 0) {
        alert('Errores encontrados:\n' + errores.join('\n'));
        return false;
    }
    
    return true;
}

// Función para exportar datos de cotización
function exportarDatosCotizacion() {
    const datos = {
        cotizacion: document.querySelector('.titulo-grande').textContent,
        productos: []
    };
    
    const productos = document.querySelectorAll('.producto-item');
    productos.forEach(function(producto, index) {
        const nombre = producto.querySelector('.producto-nombre').textContent;
        const cantidad = producto.querySelector('input[name*="[cantidad]"]').value;
        const costoTotal = producto.querySelector('.resultado-row span:last-child').textContent;
        
        datos.productos.push({
            nombre: nombre,
            cantidad: cantidad,
            costoTotal: costoTotal
        });
    });
    
    console.log('Datos de cotización:', datos);
    return datos;
}

// Agregar validación al formulario
document.addEventListener('DOMContentLoaded', function() {
    const formulario = document.querySelector('form');
    if (formulario) {
        formulario.addEventListener('submit', function(e) {
            if (!validarFormulario()) {
                e.preventDefault();
            }
        });
    }
});

// ===== FUNCIONES PARA GUARDAR COTIZACIÓN =====

// Función para validar datos antes de guardar
function validarDatosParaGuardar() {
    let errores = [];
    
    const productos = document.querySelectorAll('.producto-item');
    productos.forEach(function(producto, index) {
        const cantidad = parseFloat(producto.querySelector('input[name*="[cantidad]"]').value) || 0;
        const margen = parseFloat(producto.querySelector('input[name*="[margen]"]').value) || 0;
        const costo = parseFloat(producto.querySelector('input[name*="[costo_producto]"]').value) || 0;
        
        if (cantidad <= 0) {
            errores.push(`Producto ${index + 1}: La cantidad debe ser mayor a 0`);
        }
        
        if (margen < 1) {
            errores.push(`Producto ${index + 1}: El margen debe ser mayor o igual a 1`);
        }
        
        if (costo <= 0) {
            errores.push(`Producto ${index + 1}: El costo debe ser mayor a 0`);
        }
		
		// Validar métodos de impresión incompletos
		const metodo = producto.querySelector('select[name*="[metodo_impresion]"]').value;
		const subMetodo = producto.querySelector('select[name*="[sub_metodo]"]').value;

		if (metodo && !subMetodo) {
			errores.push(`Producto ${index + 1}: Si selecciona método de impresión debe seleccionar también el sub-método`);
		}
    });
    
    if (errores.length > 0) {
        alert('Errores encontrados antes de guardar:\n\n' + errores.join('\n'));
        return false;
    }
    
    return true;
}

// Configurar validación del botón guardar cuando carga la página
document.addEventListener('DOMContentLoaded', function() {
    const btnGuardar = document.querySelector('button[value="guardar"]');
    if (btnGuardar) {
        btnGuardar.addEventListener('click', function(e) {
            // Primero validar datos
            if (!validarDatosParaGuardar()) {
                e.preventDefault();
                return false;
            }
            
            // Luego confirmar (ya está en el onclick del HTML)
            // No necesitamos hacer nada más aquí
        });
    }
});

// ===== PRUEBA DE SINCRONIZACIÓN CON GITHUB =====
// Este comentario fue agregado para probar la sincronización con GitHub
// Fecha: $(date)