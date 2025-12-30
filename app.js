// ========================================
// Configuración
// ========================================

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTXEZOcduqT6LDEGsqwkecQMojBvdY9ejfvsu84luiq-v9YJDtyPhWbLbA6RMwm8256vpzB39kHUesE/pub?gid=411263367&single=true&output=csv';
const CORS_PROXY = 'https://corsproxy.io/?';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwY6RBxV9lu_TUZMtdmyv2aa50q8VQtPzebORmVHz19rm5Ur6EVsOJdQ_KAP_c4ZtcZ/exec';

const USUARIOS = {
    'admin': { password: 'admin123', nombre: 'Dra. Cristina García Domínguez', rol: 'Administrador' },
    'admin17': { password: 'Gardom17', nombre: 'Dra. Cristina García Domínguez', rol: 'Administrador' },
    'secretaria': { password: 'sec123', nombre: 'Secretaria', rol: 'Secretaria' }
};

let usuarioActual = null;
let fechaSeleccionada = new Date();
let todasLasCitas = [];
let todosPacientes = [];

// Estado de filtros interactivos
let filtrosActivos = {
    especialidad: null,
    tipoSeguro: null,
    mes: null,
    motivo: null
};

// ========================================
// Login
// ========================================

document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = document.getElementById('login-user').value.toLowerCase();
    const pass = document.getElementById('login-pass').value;
    const errorDiv = document.getElementById('login-error');

    if (USUARIOS[user] && USUARIOS[user].password === pass) {
        usuarioActual = { username: user, ...USUARIOS[user] };
        sessionStorage.setItem('usuario', JSON.stringify(usuarioActual));
        mostrarApp();
    } else {
        errorDiv.textContent = 'Usuario o contraseña incorrectos';
        errorDiv.style.display = 'block';
    }
});

document.getElementById('btn-logout').addEventListener('click', () => {
    usuarioActual = null;
    sessionStorage.removeItem('usuario');
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('login-page').style.display = 'flex';
    document.getElementById('login-user').value = '';
    document.getElementById('login-pass').value = '';
});

function mostrarApp() {
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    document.getElementById('user-name').textContent = usuarioActual.nombre;
    document.getElementById('user-role').textContent = usuarioActual.rol;
    document.getElementById('user-avatar').textContent = usuarioActual.nombre[0].toUpperCase();

    // Aplicar permisos según rol
    aplicarPermisosRol();

    // Sincronizar estados desde Google Sheets al iniciar
    sincronizarEstados();

    cargarDashboard();

    // Iniciar auto-sincronización
    iniciarAutoSync();
}

// Control de permisos por rol
function aplicarPermisosRol() {
    const esSecretaria = usuarioActual.rol === 'Secretaria';

    // Ocultar Estadísticas para Secretaria
    const statsNav = document.querySelector('.nav-item[data-view="estadisticas"]');
    if (statsNav) {
        statsNav.style.display = esSecretaria ? 'none' : 'flex';
    }

    // Auditoría solo Admin
    const auditNav = document.getElementById('nav-auditoria');
    if (auditNav) {
        auditNav.style.display = esSecretaria ? 'none' : 'flex';
    }

    // Finanzas solo Admin
    const finNav = document.getElementById('nav-finanzas');
    if (finNav) {
        finNav.style.display = esSecretaria ? 'none' : 'flex';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const savedUser = sessionStorage.getItem('usuario');
    if (savedUser) {
        usuarioActual = JSON.parse(savedUser);
        mostrarApp();
    }

    // Hacer stats clickeables
    document.getElementById('stat-pacientes')?.parentElement?.parentElement?.addEventListener('click', () => {
        if (todosPacientes.length > 0) mostrarModalPacientes();
    });
    document.getElementById('stat-total')?.parentElement?.parentElement?.addEventListener('click', () => {
        if (todasLasCitas.length > 0) cambiarVista('citas');
    });
});

// ========================================
// Navegación
// ========================================

document.querySelectorAll('.nav-item, .link-btn').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const view = item.dataset.view;
        if (view) cambiarVista(view);
    });
});

function cambiarVista(vista) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`view-${vista}`).classList.add('active');
    document.querySelector(`.nav-item[data-view="${vista}"]`)?.classList.add('active');
    if (vista === 'citas') cargarAgenda();
    if (vista === 'pacientes') cargarPacientes();
    if (vista === 'estadisticas') cargarEstadisticas();
    if (vista === 'auditoria') cargarAuditoria();
    if (vista === 'finanzas') cargarFinanzas();
}

// ========================================
// Cargar datos desde Google Sheets
// ========================================

async function cargarDatosDeGoogle() {
    try {
        const response = await fetch(CORS_PROXY + encodeURIComponent(SHEET_URL));
        const csv = await response.text();
        return parsearCSV(csv);
    } catch (error) {
        console.error('Error cargando Google Sheets:', error);
        return [];
    }
}

function parsearCSV(csv) {
    const lineas = csv.split('\n');
    if (lineas.length < 2) return [];

    // Parse headers properly handling CSV with quotes
    const headersRaw = parsearLinea(lineas[0]);
    const headers = headersRaw.map(h => h.toLowerCase().trim());
    const citas = [];

    console.log('=== HEADERS ENCONTRADOS ===');
    headers.forEach((h, i) => console.log(`${i}: "${h}"`));

    // Detección avanzada de columnas de seguro
    const idxSeguroNombre = headers.findIndex(h => (h.includes('nombre') && h.includes('seguro')) || h.includes('ars') || h.includes('aseguradora'));
    const idxSeguroTipo = headers.findIndex(h => h.includes('privada') || (h.includes('seguro') && !h.includes('nombre')));

    const colIndices = {
        nombre: headers.findIndex(h => h.includes('nombre') && (h.includes('paciente') || h.includes('completo'))),
        fecha: headers.findIndex(h => h.includes('fecha')),
        telefono: headers.findIndex(h => h.includes('tel')),
        motivo: headers.findIndex(h => h.includes('motivo') && h.includes('principal')),
        especialidad: headers.findIndex(h => h.includes('especialidad')),
        seguroNombre: idxSeguroNombre,
        seguroTipo: idxSeguroTipo,
        timestamp: headers.findIndex(h => h.includes('marca') || h.includes('timestamp') || h.includes('tiempo'))
    };

    console.log('=== ÍNDICES DE COLUMNAS ===', colIndices);

    for (let i = 1; i < lineas.length; i++) {
        if (!lineas[i].trim()) continue;

        const valores = parsearLinea(lineas[i]);

        const nombre = (valores[colIndices.nombre] || '').trim();
        const fecha = (valores[colIndices.fecha] || '').trim();
        const telefono = (valores[colIndices.telefono] || '').trim();
        const motivoPrincipal = (valores[colIndices.motivo] || '').trim();
        const especialidad = (valores[colIndices.especialidad] || '').trim();
        const valSeguroNombre = (colIndices.seguroNombre !== -1) ? (valores[colIndices.seguroNombre] || '').trim() : '';
        const valSeguroTipo = (colIndices.seguroTipo !== -1) ? (valores[colIndices.seguroTipo] || '').trim() : '';
        const rawSeguro = valSeguroNombre || valSeguroTipo; // Priorizar nombre, fallback a tipo
        const timestampStr = (colIndices.timestamp !== -1) ? (valores[colIndices.timestamp] || '') : '';

        // Parsear fecha de creación para ordenamiento y display
        let fechaCreacion = new Date(0);
        if (timestampStr) {
            // Intento 1: Parseo directo del navegador (cubre ISO y formatos locales comunes)
            const dNativo = new Date(timestampStr);
            if (!isNaN(dNativo.getTime())) {
                fechaCreacion = dNativo;
            } else {
                // Intento 2: Parseo manual robusto para dd/mm/yyyy ó mm/dd/yyyy
                try {
                    // Limpiar caracteres extraños
                    const cleanTs = timestampStr.trim().replace(/am|pm|AM|PM/g, '').trim();
                    const parts = cleanTs.split(' ');
                    const dateParts = parts[0].split('/');

                    if (dateParts.length === 3) {
                        const timePart = parts.length > 1 ? parts[1] : '00:00:00';
                        // Asumir dd/mm/yyyy (Latinoamérica/Europa)
                        const isoLat = `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}T${timePart}`;
                        const dLat = new Date(isoLat);

                        if (!isNaN(dLat.getTime())) {
                            fechaCreacion = dLat;
                        } else {
                            // Asumir mm/dd/yyyy (US)
                            const isoUs = `${dateParts[2]}-${dateParts[0].padStart(2, '0')}-${dateParts[1].padStart(2, '0')}T${timePart}`;
                            const dUs = new Date(isoUs);
                            if (!isNaN(dUs.getTime())) fechaCreacion = dUs;
                        }
                    }
                } catch (e) { console.warn('Error parseando timestamp manual', timestampStr); }
            }
        }

        if (nombre) {
            const tipoSeguroNormalizado = normalizarSeguroSimple(rawSeguro);

            // Lógica de Homologación ARS Avanzada
            let nombreArsReal = 'N/A';
            if (tipoSeguroNormalizado === 'Seguro Médico') {
                nombreArsReal = normalizarNombreARS(rawSeguro);
                // Si con el valor principal no encontramos ARS, intentamos con el otro campo si existe
                if (nombreArsReal === 'Seguro Genérico (No especificado)' && valSeguroTipo && valSeguroTipo !== rawSeguro) {
                    const intento = normalizarNombreARS(valSeguroTipo);
                    if (intento !== 'Seguro Genérico (No especificado)' && intento !== 'Privada') {
                        nombreArsReal = intento;
                    }
                }
            } else {
                nombreArsReal = 'Privada';
            }

            const precio = calcularPrecio(especialidad, tipoSeguroNormalizado, motivoPrincipal);

            citas.push({
                id: citas.length + 1,
                paciente: nombre,
                fecha: parsearFecha(fecha),
                fechaTexto: fecha,
                telefono: telefono || 'No especificado',
                motivoPrincipal: motivoPrincipal || 'Consulta general',
                especialidad: especialidad || 'No especificado',
                tipoSeguro: tipoSeguroNormalizado,
                nombreArs: nombreArsReal,
                precio: precio,
                estado: 'Solicitada',
                creadoEn: fechaCreacion,
                creadoEnTexto: timestampStr
            });
        }
    }

    console.log(`=== TOTAL CITAS PARSEADAS: ${citas.length} ===`);
    return citas;
}

// Tabla de precios
const PRECIOS = {
    cardiologia_seguro: 2500,
    cardiologia_privado: 3500,
    pediatria_seguro: 2000,
    pediatria_privado: 3000,
    entrega_resultados: 500
};

function calcularPrecio(especialidad, tipoSeguro, motivo) {
    const espLower = (especialidad || '').toLowerCase();
    const motivoLower = (motivo || '').toLowerCase();

    // Entrega de resultados
    if (motivoLower.includes('entrega') && motivoLower.includes('resultado')) {
        return PRECIOS.entrega_resultados;
    }

    const esSeguro = tipoSeguro === 'Seguro Médico';

    // Cardiología
    if (espLower.includes('cardio')) {
        return esSeguro ? PRECIOS.cardiologia_seguro : PRECIOS.cardiologia_privado;
    }

    // Pediatría
    if (espLower.includes('pediatr')) {
        return esSeguro ? PRECIOS.pediatria_seguro : PRECIOS.pediatria_privado;
    }

    // Default
    return 0;
}

// Lista de ARS Homologadas
const ARS_LISTA = [
    'MAPFRE Salud ARS, S.A.', 'ARS Universal, S.A.', 'Yunen ARS, S.A.',
    'Seguro Nacional de Salud (SENASA)', 'ARS Humano, S.A.',
    'ARS ASEMAP', 'ARS Futuro', 'META Salud ARS', 'ARS Renacer', 'ARS Reservas'
];

function normalizarNombreARS(valor) {
    if (!valor || valor.trim() === '') return 'Privada';
    const v = valor.toLowerCase();

    // Mapeos inteligentes (Keywords -> Nombre Oficial)
    if (v.includes('mapfre') || v.includes('palic')) return 'MAPFRE Salud ARS, S.A.';
    if (v.includes('universal')) return 'ARS Universal, S.A.';
    if (v.includes('yunen')) return 'Yunen ARS, S.A.';
    if (v.includes('senasa') || v.includes('nacional')) return 'Seguro Nacional de Salud (SENASA)';
    if (v.includes('humano') || v.includes('primera')) return 'ARS Humano, S.A.';
    if (v.includes('asemap')) return 'ARS ASEMAP';
    if (v.includes('futuro')) return 'ARS Futuro';
    if (v.includes('meta')) return 'META Salud ARS';
    if (v.includes('renacer') || v.includes('monumental')) return 'ARS Renacer';
    if (v.includes('reservas')) return 'ARS Reservas';

    // Genéricos
    if (v.includes('seguro') || v === 'si') return 'Seguro Genérico (No especificado)';

    return valor; // Retornar valor original como último recurso
}

function normalizarSeguroSimple(valor) {
    if (!valor || valor.trim() === '') return 'Privada';

    // Intentar detectar nombre de ARS
    const nombreNormalizado = normalizarNombreARS(valor);

    // Si se detectó una ARS oficial o Genérica
    if (ARS_LISTA.includes(nombreNormalizado) || nombreNormalizado === 'Seguro Genérico (No especificado)') {
        return 'Seguro Médico';
    }

    // Fallbacks
    const lower = valor.toLowerCase();
    if (lower.includes('seguro') && !lower.includes('no')) return 'Seguro Médico';
    if (lower.includes('privad') || lower.includes('particular')) return 'Privada';

    return 'Privada';
}

// Normalizar teléfono: eliminar todo excepto dígitos
function normalizarTelefono(telefono) {
    if (!telefono) return '';
    // Eliminar todo excepto dígitos (parentesis, guiones, espacios, etc.)
    return telefono.replace(/\D/g, '');
}

// Deduplicar citas: mismo teléfono + misma fecha = mismo paciente
// Mantiene la cita con el nombre más largo/completo
function deduplicarCitas(citas) {
    const citasUnicas = {};

    citas.forEach(cita => {
        const telefonoNorm = normalizarTelefono(cita.telefono);
        // Clave única: teléfono + fecha
        const clave = `${telefonoNorm}_${cita.fecha}`;

        if (!citasUnicas[clave]) {
            // Primera vez que vemos esta combinación
            citasUnicas[clave] = cita;
        } else {
            // Ya existe una cita para este teléfono+fecha
            // Mantener la que tiene el nombre más largo (más completo)
            if (cita.paciente.length > citasUnicas[clave].paciente.length) {
                citasUnicas[clave] = cita;
            }
        }
    });

    console.log(`📋 Deduplicación: ${citas.length} citas → ${Object.keys(citasUnicas).length} únicas`);
    return Object.values(citasUnicas);
}

function parsearLinea(linea) {
    const valores = [];
    let actual = '';
    let enComillas = false;
    let i = 0;

    while (i < linea.length) {
        const char = linea[i];

        if (char === '"') {
            // Si estamos al inicio o después de una coma, comenzar campo con comillas
            if (!enComillas && (actual === '' || actual.trim() === '')) {
                enComillas = true;
            } else if (enComillas) {
                // Si hay dos comillas seguidas, es escape
                if (linea[i + 1] === '"') {
                    actual += '"';
                    i++;
                } else {
                    enComillas = false;
                }
            }
        } else if (char === ',' && !enComillas) {
            valores.push(limpiarValor(actual));
            actual = '';
        } else {
            actual += char;
        }
        i++;
    }
    valores.push(limpiarValor(actual));

    return valores;
}

function limpiarValor(valor) {
    // Remover comillas, espacios extra, y caracteres de retorno
    return valor.trim().replace(/^"|"$/g, '').replace(/\r/g, '').trim();
}

function parsearFecha(fechaStr) {
    if (!fechaStr) return null;

    const meses = {
        'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
        'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
        'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
    };

    const str = fechaStr.toLowerCase().trim();

    // Buscar patrón: día + de + mes (ej: "23 de diciembre", "Martes 23 de Diciembre", "Jueves 08 de Enero de 2025")
    const matches = str.match(/(\d+)\s+de\s+(\w+)/);

    if (matches) {
        const dia = matches[1].padStart(2, '0');
        const mesNombre = matches[2];
        const mes = meses[mesNombre];
        if (mes) {
            let año;

            // Primero intentar extraer el año del texto (nuevo formato: "de 2025")
            const matchAño = str.match(/de\s+(\d{4})/);
            if (matchAño) {
                año = parseInt(matchAño[1], 10);
            } else {
                // Si no tiene año, calcularlo automáticamente
                const hoy = new Date();
                año = hoy.getFullYear();

                // Lógica mejorada para detectar si la cita es del próximo año:
                // Si estamos en los últimos meses del año (oct-dic) y la cita es para
                // los primeros meses (ene-mar), asumimos que es para el próximo año
                const mesActual = hoy.getMonth() + 1; // 1-12
                const mesNum = parseInt(mes, 10);

                if (mesNum <= 3 && mesActual >= 10) {
                    año = año + 1;
                }
            }

            const fechaResultado = `${año}-${mes}-${dia}`;
            console.log(`📅 Parseando fecha: "${fechaStr}" → ${fechaResultado}`);
            return fechaResultado;
        }
    }

    // Intentar formato de fecha estándar dd/mm/yyyy o mm/dd/yyyy
    const matchFecha = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (matchFecha) {
        const [, d, m, y] = matchFecha;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    console.log(`⚠️ No se pudo parsear la fecha: "${fechaStr}"`);
    return null;
}

// ========================================
// Dashboard
// ========================================

// Auto-sync configuration
const AUTO_SYNC_INTERVAL = 60000; // 60 segundos
let autoSyncTimer = null;
let ultimaActualizacion = null;

// Actualizar indicador de última sincronización
function actualizarIndicadorSync(sincronizando = false) {
    const indicator = document.querySelector('.sync-indicator');
    const syncText = document.getElementById('ultima-sync');

    if (!indicator || !syncText) return;

    if (sincronizando) {
        indicator.classList.add('syncing');
        syncText.textContent = 'Sincronizando...';
    } else {
        indicator.classList.remove('syncing');
        if (ultimaActualizacion) {
            const ahora = new Date();
            const diff = Math.floor((ahora - ultimaActualizacion) / 1000);

            if (diff < 60) {
                syncText.textContent = 'Actualizado hace ' + diff + 's';
            } else if (diff < 3600) {
                syncText.textContent = 'Actualizado hace ' + Math.floor(diff / 60) + 'm';
            } else {
                syncText.textContent = ultimaActualizacion.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
            }
        }
    }
}

// Actualizar el texto del indicador cada 10 segundos
setInterval(() => {
    if (ultimaActualizacion && !document.querySelector('.sync-indicator')?.classList.contains('syncing')) {
        actualizarIndicadorSync(false);
    }
}, 10000);

async function cargarDashboard(esAutoSync = false) {
    const hoy = new Date();
    document.getElementById('fecha-hoy').textContent = hoy.toLocaleDateString('es-DO', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    // Mostrar indicador de sincronización
    actualizarIndicadorSync(true);

    if (!esAutoSync) {
        document.getElementById('citas-hoy-lista').innerHTML = '<p class="empty-state">Cargando citas...</p>';
    }

    todasLasCitas = await cargarDatosDeGoogle();

    // Verificar si hay nuevas citas (para notificaciones)
    verificarNuevasCitas(todasLasCitas);
    verificarAlertasBadge();

    // Registrar hora de última actualización
    ultimaActualizacion = new Date();
    actualizarIndicadorSync(false);

    const hoyStr = hoy.toISOString().split('T')[0];
    let citasHoy = todasLasCitas.filter(c => c.fecha === hoyStr);

    // Deduplicar citas de hoy: mismo teléfono + misma fecha = una sola cita
    citasHoy = deduplicarCitas(citasHoy);

    // Extraer pacientes únicos por teléfono normalizado (clave primaria)
    const pacientesMap = {};
    todasLasCitas.forEach(c => {
        const telefonoNorm = normalizarTelefono(c.telefono);
        // Usar teléfono normalizado como clave, ignorar entradas sin teléfono válido
        if (telefonoNorm && telefonoNorm.length >= 7) {
            if (!pacientesMap[telefonoNorm]) {
                pacientesMap[telefonoNorm] = {
                    nombre: c.paciente,
                    telefono: c.telefono,
                    telefonoNorm: telefonoNorm,
                    citas: 1
                };
            } else {
                pacientesMap[telefonoNorm].citas++;
                // Mantener el nombre más reciente o más largo
                if (c.paciente.length > pacientesMap[telefonoNorm].nombre.length) {
                    pacientesMap[telefonoNorm].nombre = c.paciente;
                }
            }
        }
    });
    todosPacientes = Object.values(pacientesMap);

    // Calcular pacientes nuevos (1 cita) vs recurrentes (2+ citas)
    const pacientesNuevos = todosPacientes.filter(p => p.citas === 1);
    const pacientesRecurrentes = todosPacientes.filter(p => p.citas >= 2);

    document.getElementById('stat-citas-hoy').textContent = citasHoy.length;
    document.getElementById('stat-pacientes').textContent = todosPacientes.length;
    document.getElementById('stat-total').textContent = todasLasCitas.length;
    document.getElementById('stat-nuevos').textContent = pacientesNuevos.length;
    document.getElementById('stat-recurrentes').textContent = pacientesRecurrentes.length;

    // Hacer stats clickeables
    document.getElementById('card-pacientes')?.addEventListener('click', () => mostrarModalPacientes(todosPacientes, 'Todos los Pacientes'));
    document.getElementById('card-citas')?.addEventListener('click', () => cambiarVista('citas'));
    document.getElementById('card-nuevos')?.addEventListener('click', () => mostrarModalPacientes(pacientesNuevos, 'Pacientes Nuevos (1 cita)'));
    document.getElementById('card-recurrentes')?.addEventListener('click', () => mostrarModalPacientes(pacientesRecurrentes, 'Pacientes Recurrentes (2+ citas)'));

    mostrarCitas(citasHoy, 'citas-hoy-lista');

    // Mostrar notificación solo en actualización manual
    if (!esAutoSync && ultimaActualizacion) {
        console.log('✅ Dashboard actualizado manualmente a las', ultimaActualizacion.toLocaleTimeString());
    }
}

// Iniciar auto-sync
function iniciarAutoSync() {
    // Detener timer anterior si existe
    if (autoSyncTimer) {
        clearInterval(autoSyncTimer);
    }

    // Iniciar nuevo timer
    autoSyncTimer = setInterval(() => {
        console.log('🔄 Auto-sync ejecutándose...');
        cargarDashboard(true); // true = es auto-sync
    }, AUTO_SYNC_INTERVAL);

    console.log('⏱️ Auto-sync iniciado: cada ' + (AUTO_SYNC_INTERVAL / 1000) + ' segundos');
}

// Detener auto-sync (útil si se implementa toggle)
function detenerAutoSync() {
    if (autoSyncTimer) {
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
        console.log('⏹️ Auto-sync detenido');
    }
}

// Botón de actualización manual
document.getElementById('btn-refresh')?.addEventListener('click', () => {
    cargarDashboard(false); // false = actualización manual
    showToast('Datos actualizados', 'success');
});

// ========================================
// Lógica de Gestión de Citas (CRUD & Estados)
// ========================================

function generarCitaId(cita) {
    if (cita.id) return String(cita.id);
    // ID determinista basado en contenido si no hay ID único
    return `${cita.fecha}-${cita.telefono}-${cita.paciente}`.replace(/[^a-zA-Z0-9]/g, '');
}

function getCitaEstado(citaId) {
    const estados = JSON.parse(localStorage.getItem('citasEstados') || '{}');
    return estados[citaId] || 'solicitada';
}

// setCitaEstado is defined later as async function with cloud sync (line ~1019)

function getCitasReagendadas() {
    return JSON.parse(localStorage.getItem('citasReagendadas') || '[]');
}

async function confirmarCita(citaId) {
    const confirmado = await showConfirm('¿Estás seguro de que deseas confirmar esta cita?', 'Confirmar Cita');
    if (confirmado) {
        setCitaEstado(citaId, 'confirmada');
        // Registrar Auditoría
        registrarAuditoria('Confirmar Cita', `Cita confirmada ID: ${citaId}`, { citaId });

        showToast('Cita confirmada exitosamente', 'success');
        recargarVistaActual();
    }
}

// Variable temporal para el ID de la cita a cancelar
let citaCancelacionId = null;

function cancelarCita(citaId) {
    // Abrir modal de motivo obligatorio
    citaCancelacionId = citaId;
    const modal = document.getElementById('modal-cancelacion');
    if (modal) {
        modal.style.display = 'flex';
        // Resetear form
        document.getElementById('motivo-cancelacion').value = "";
        document.getElementById('nota-cancelacion').value = "";
    }
}

function reagendarCita(citaId) {
    // Usar DatePicker Modal existente
    openDatePicker(null, (nuevaFecha) => {
        if (nuevaFecha) {
            const year = nuevaFecha.getFullYear();
            const month = String(nuevaFecha.getMonth() + 1).padStart(2, '0');
            const day = String(nuevaFecha.getDate()).padStart(2, '0');
            const nuevaFechaStr = `${day}/${month}/${year}`; // Formato dd/mm/yyyy para compatibilidad visual

            // Simulación de reagendado (guardar en localStorage para fusionar luego)
            const lista = getCitasReagendadas();
            // Buscar en todasLasCitas (ya sea array global o filtrado)
            const citaOriginal = todasLasCitas.find(c => generarCitaId(c) === String(citaId));

            if (citaOriginal) {
                // Crear copia reagendada
                const nuevaCita = { ...citaOriginal, fecha: nuevaFechaStr, fechaTexto: nuevaFechaStr, estado: 'reagendada_ok' };
                // Asignar nuevo ID temporal para evitar colisiones
                nuevaCita.id = 'R-' + Date.now();

                lista.push(nuevaCita);
                localStorage.setItem('citasReagendadas', JSON.stringify(lista));

                // Marcar original como "reagendada"
                setCitaEstado(citaId, 'reagendada');

                // Log Auditoría
                registrarAuditoria('Reagendar Cita', `Reagendada para ${nuevaFechaStr}. ID Original: ${citaId}`, {
                    citaId, nuevaFecha: nuevaFechaStr
                });

                showToast(`Cita reagendada para el ${nuevaFechaStr}`, 'success');
                recargarVistaActual();
            } else {
                showToast('No se pudo encontrar los datos de la cita original', 'error');
            }
        }
    });
}

function recargarVistaActual() {
    if (document.getElementById('view-citas')?.classList.contains('active')) {
        cargarAgenda();
    } else if (document.getElementById('view-dashboard')?.classList.contains('active')) {
        cargarDashboard();
    } else {
        // Fallback genérico
        cargarAgenda();
    }
}

function getInitials(nombre) {
    if (!nombre) return '??';
    return nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function formatearFechaLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${day}/${month}/${year}`; // Usar formato display por defecto
}

// ========================================
// Modal de Pacientes
// ========================================

let modalPacientesActuales = [];

function mostrarModalPacientes(pacientes = todosPacientes, titulo = 'Todos los Pacientes') {
    modalPacientesActuales = pacientes;

    // Crear modal si no existe
    let modal = document.getElementById('modal-pacientes');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-pacientes';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>👥 ${titulo} (${pacientes.length})</h3>
                <button class="modal-close" onclick="cerrarModal()">&times;</button>
            </div>
            <div class="modal-body">
                <input type="text" id="modal-buscar" placeholder="🔍 Buscar paciente..." class="modal-search">
                <div class="modal-list" id="modal-lista-pacientes">
                    ${renderizarListaPacientes(pacientes)}
                </div>
            </div>
        </div>
    `;

    modal.style.display = 'flex';

    // Buscar en modal
    document.getElementById('modal-buscar')?.addEventListener('input', (e) => {
        const busqueda = e.target.value.toLowerCase();
        const filtrados = modalPacientesActuales.filter(p => p.nombre.toLowerCase().includes(busqueda));
        document.getElementById('modal-lista-pacientes').innerHTML = renderizarListaPacientes(filtrados);
    });
}

function renderizarListaPacientes(pacientes) {
    if (pacientes.length === 0) {
        return '<p class="empty-state">No se encontraron pacientes</p>';
    }
    return pacientes.map(p => `
        <div class="modal-item" onclick="mostrarHistorialPaciente('${p.nombre}')" style="cursor: pointer;" title="Ver historial clínico">
            <div class="paciente-avatar">${getInitials(p.nombre)}</div>
            <div class="modal-item-info">
                <strong>${p.nombre}</strong>
                <span>📞 ${p.telefono} • ${p.citas} cita${p.citas !== 1 ? 's' : ''}</span>
            </div>
        </div>
    `).join('');
}

function cerrarModal() {
    const modal = document.getElementById('modal-pacientes');
    if (modal) modal.style.display = 'none';
}

// Cerrar modal al hacer clic fuera
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        cerrarModal();
    }
});

// ========================================
// Agenda
// ========================================

async function cargarAgenda() {
    if (todasLasCitas.length === 0) {
        todasLasCitas = await cargarDatosDeGoogle();
    }

    const filtroEl = document.getElementById('agenda-estado-filter');
    const filtroEstado = filtroEl ? filtroEl.value : 'dia';
    const btnPrev = document.getElementById('btn-prev-day');
    const btnNext = document.getElementById('btn-next-day');

    if (filtroEstado !== 'dia') {
        const titulos = {
            todas: 'Historial Completo (Últimas 200)',
            confirmada: 'Historial: Confirmadas',
            cancelada: 'Historial: Canceladas',
            reagendada: 'Historial: Reagendadas',
            completada: 'Historial: Completadas'
        };
        document.getElementById('fecha-seleccionada').textContent = titulos[filtroEstado] || 'Historial Filtrado';
        if (btnPrev) btnPrev.style.visibility = 'hidden';
        if (btnNext) btnNext.style.visibility = 'hidden';
    } else {
        actualizarFechaDisplay();
        if (btnPrev) btnPrev.style.visibility = 'visible';
        if (btnNext) btnNext.style.visibility = 'visible';
    }

    let citasFiltradas = [];

    if (filtroEstado === 'dia') {
        const fechaStr = formatearFechaLocal(fechaSeleccionada);
        // Filtro standard por fecha
        citasFiltradas = todasLasCitas.filter(c => {
            const citaId = generarCitaId(c);
            const estado = getCitaEstado(citaId);
            return c.fecha === fechaStr && estado !== 'reagendada';
        });

        // Sumar reagendadas
        const reagendadas = getCitasReagendadas();
        reagendadas.forEach(c => {
            if (c.fecha === fechaStr) citasFiltradas.push(c);
        });

    } else {
        // Filtro Global
        let universo = [...todasLasCitas, ...getCitasReagendadas()];

        if (filtroEstado === 'todas') {
            citasFiltradas = universo;
        } else {
            citasFiltradas = universo.filter(c => {
                const id = generarCitaId(c);
                const est = getCitaEstado(id);
                // Incluir reagendadas activas (reagendada_ok) en filtro "Reagendada"
                return est === filtroEstado || (filtroEstado === 'reagendada' && est === 'reagendada_ok');
            });
        }

        // Ordenar LIFO (recientes primero)
        citasFiltradas.reverse();
        // Limitar
        if (citasFiltradas.length > 200) citasFiltradas = citasFiltradas.slice(0, 200);
    }

    // Deduplicar y Renderizar
    citasFiltradas = deduplicarCitas(citasFiltradas);
    document.getElementById('citas-count').textContent = `${citasFiltradas.length} cita${citasFiltradas.length !== 1 ? 's' : ''}`;
    mostrarCitas(citasFiltradas, 'citas-agenda-lista');
}

// Listener para el filtro de agenda
document.getElementById('agenda-estado-filter')?.addEventListener('change', () => cargarAgenda());

function actualizarFechaDisplay() {
    // Actualizar texto
    document.getElementById('fecha-seleccionada').textContent = fechaSeleccionada.toLocaleDateString('es-DO', {
        weekday: 'long', day: 'numeric', month: 'long'
    });

    // Actualizar valor del input date (YYYY-MM-DD)
    const year = fechaSeleccionada.getFullYear();
    const month = String(fechaSeleccionada.getMonth() + 1).padStart(2, '0');
    const day = String(fechaSeleccionada.getDate()).padStart(2, '0');
    document.getElementById('fecha-picker').value = `${year}-${month}-${day}`;
}

document.getElementById('fecha-picker')?.addEventListener('change', (e) => {
    if (e.target.value) {
        // Crear fecha desde input (ajustando zona horaria para evitar desfase)
        const [y, m, d] = e.target.value.split('-').map(Number);
        fechaSeleccionada = new Date(y, m - 1, d);
        cargarAgenda();
    }
});

document.getElementById('btn-prev-day')?.addEventListener('click', () => {
    fechaSeleccionada.setDate(fechaSeleccionada.getDate() - 1);
    cargarAgenda();
});

document.getElementById('btn-next-day')?.addEventListener('click', () => {
    fechaSeleccionada.setDate(fechaSeleccionada.getDate() + 1);
    cargarAgenda();
});

// ========================================
// Pacientes
// ========================================

async function cargarPacientes() {
    if (todasLasCitas.length === 0) {
        todasLasCitas = await cargarDatosDeGoogle();
    }

    // Usar teléfono normalizado como clave primaria para deduplicación
    const pacientesMap = {};
    todasLasCitas.forEach(c => {
        const telefonoNorm = normalizarTelefono(c.telefono);
        if (telefonoNorm && telefonoNorm.length >= 7) {
            if (!pacientesMap[telefonoNorm]) {
                pacientesMap[telefonoNorm] = {
                    nombre: c.paciente,
                    telefono: c.telefono,
                    telefonoNorm: telefonoNorm,
                    especialidad: c.especialidad,
                    tipoSeguro: c.tipoSeguro,
                    citas: 1
                };
            } else {
                pacientesMap[telefonoNorm].citas++;
                // Mantener el nombre más largo
                if (c.paciente.length > pacientesMap[telefonoNorm].nombre.length) {
                    pacientesMap[telefonoNorm].nombre = c.paciente;
                }
            }
        }
    });

    todosPacientes = Object.values(pacientesMap);
    document.getElementById('pacientes-count').textContent = `${todosPacientes.length} pacientes registrados`;
    mostrarPacientesLista(todosPacientes);
}

function mostrarPacientesLista(pacientes) {
    const container = document.getElementById('pacientes-lista');

    if (pacientes.length === 0) {
        container.innerHTML = '<p class="empty-state">No se encontraron pacientes</p>';
        return;
    }

    container.innerHTML = pacientes.map(p => `
        <div class="paciente-card" onclick="mostrarHistorialPaciente('${p.nombre}')" style="cursor: pointer;" title="Ver historial clínico">
            <div class="paciente-avatar">${getInitials(p.nombre)}</div>
            <div class="paciente-info">
                <h4>${p.nombre}</h4>
                <p>📞 ${p.telefono}</p>
                <p>🩺 ${p.especialidad || 'Pediatría'}</p>
                <p>💳 ${p.tipoSeguro || 'No especificado'}</p>
                <p>📋 ${p.citas} cita${p.citas !== 1 ? 's' : ''}</p>
            </div>
        </div>
    `).join('');
}

document.getElementById('buscar-paciente')?.addEventListener('input', (e) => {
    const busqueda = e.target.value.toLowerCase();
    const filtrados = todosPacientes.filter(p =>
        p.nombre.toLowerCase().includes(busqueda) ||
        (p.telefono && p.telefono.includes(busqueda))
    );
    mostrarPacientesLista(filtrados);
});

// ========================================
// Helpers
// ========================================

// Estado de citas (sincronizado con Google Sheets)
let estadosCache = {};
let sincronizando = false;

function getCitasEstado() {
    // Primero del cache, luego de localStorage como fallback
    if (Object.keys(estadosCache).length > 0) {
        return estadosCache;
    }
    const data = localStorage.getItem('citasEstado');
    return data ? JSON.parse(data) : {};
}

async function setCitaEstado(citaId, estado) {
    // 1. Guardar localmente para respuesta inmediata
    const estados = getCitasEstado();
    estados[citaId] = { estado, fecha: new Date().toISOString() };
    localStorage.setItem('citasEstado', JSON.stringify(estados));
    estadosCache = estados;

    // 2. Sincronizar con Google Sheets en segundo plano
    try {
        await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors', // Necesario para Apps Script
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                citaId,
                estado,
                usuario: usuarioActual?.nombre || 'Sistema'
            })
        });
        console.log('Estado sincronizado con Google Sheets:', citaId, estado);
    } catch (e) {
        console.error('Error sincronizando con Google Sheets:', e);
    }
}

function getCitaEstado(citaId) {
    const estados = getCitasEstado();
    return estados[citaId]?.estado || 'pendiente';
}

// Sincronizar estados desde Google Sheets
async function sincronizarEstados() {
    if (sincronizando) return;
    sincronizando = true;

    try {
        const response = await fetch(APPS_SCRIPT_URL);
        const estados = await response.json();

        if (estados && typeof estados === 'object' && !estados.error) {
            estadosCache = estados;
            localStorage.setItem('citasEstado', JSON.stringify(estados));
            console.log('Estados sincronizados desde Google Sheets:', Object.keys(estados).length);
        }
    } catch (e) {
        console.error('Error cargando estados desde Google Sheets:', e);
    } finally {
        sincronizando = false;
    }
}

// Sincronizar automáticamente cada 30 segundos
setInterval(sincronizarEstados, 30000);

// Generar ID único para cita basado en datos
function generarCitaId(cita) {
    return `${cita.paciente}_${cita.fecha}_${cita.telefono}`.replace(/[^a-zA-Z0-9]/g, '_');
}

function mostrarCitas(citas, containerId) {
    const container = document.getElementById(containerId);

    if (citas.length === 0) {
        container.innerHTML = '<p class="empty-state">No hay citas para mostrar 📅</p>';
        return;
    }

    const estadoLabels = {
        'pendiente': { texto: '⏳ Pendiente', clase: 'estado-pendiente' },
        'confirmada': { texto: '✅ Confirmada', clase: 'estado-confirmada' },
        'cancelada': { texto: '❌ Cancelada', clase: 'estado-cancelada' },
        'reagendada': { texto: '📅 Reagendada', clase: 'estado-reagendada' },
        'completada': { texto: '✔️ Completada', clase: 'estado-completada' }
    };

    container.innerHTML = citas.map(cita => {
        const citaId = generarCitaId(cita);
        const estado = getCitaEstado(citaId);
        const estadoInfo = estadoLabels[estado] || estadoLabels.pendiente;
        const notas = getCitaNotas(citaId);
        const idPaciente = obtenerIdPaciente(cita); // ID robusto

        // Botones de acción
        let botonesHTML = '';
        if (estado === 'cancelada') {
            botonesHTML = `
                <div class="cita-acciones">
                     <button class="btn-accion" style="background-color: #f39c12; color: white;" onclick="iniciarRestauracion('${citaId}')">↩️ Restaurar</button>
                </div>
            `;
        } else if (estado !== 'reagendada' && estado !== 'completada') {
            botonesHTML = `
                <div class="cita-acciones">
                    ${estado !== 'confirmada' ? `<button class="btn-accion btn-confirmar" onclick="confirmarCita('${citaId}')">✅ Confirmar</button>` : ''}
                    ${estado === 'confirmada' ? `<button class="btn-accion btn-completar" onclick="completarCita('${citaId}')">✔️ Completar</button>` : ''}
                    <button class="btn-accion btn-cancelar" onclick="cancelarCita('${citaId}')">❌ Cancelar</button>
                    <button class="btn-accion btn-reagendar" onclick="reagendarCita('${citaId}')">📅 Reagendar</button>
                </div>
            `;
        }

        // Mostrar notas si existen
        const notasHTML = notas ? `<div class="cita-notas">📝 ${notas}</div>` : '';

        return `
            <div class="cita-item ${estadoInfo.clase}" data-cita-id="${citaId}">
                <div class="cita-avatar" onclick="mostrarHistorialPaciente('${idPaciente}')" style="cursor:pointer" title="Ver historial">${getInitials(cita.paciente)}</div>
                <div class="cita-info">
                    <div class="cita-nombre">${cita.paciente}</div>
                    <div class="cita-detalle">📞 ${cita.telefono}</div>
                    <div class="cita-detalle">🩺 ${cita.especialidad}</div>
                    <div class="cita-detalle">📋 ${cita.motivoPrincipal}</div>
                    <div class="cita-detalle">💳 ${cita.tipoSeguro}</div>
                    <div class="cita-detalle">📅 ${cita.fechaTexto || 'Sin fecha'}</div>
                    ${notasHTML}
                    <button class="btn-add-note" onclick="agregarNota('${citaId}')">📝 Agregar nota</button>
                    ${botonesHTML}
                </div>
                <span class="cita-estado ${estadoInfo.clase}">${estadoInfo.texto}</span>
            </div>
        `;
    }).join('');
}

// Acciones de citas


// Obtener citas reagendadas de localStorage
function getCitasReagendadas() {
    const data = localStorage.getItem('citasReagendadasData');
    return data ? JSON.parse(data) : [];
}

// Formatear fecha en formato YYYY-MM-DD respetando zona horaria local
function formatearFechaLocal(fecha) {
    const year = fecha.getFullYear();
    const month = String(fecha.getMonth() + 1).padStart(2, '0');
    const day = String(fecha.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Guardar cita reagendada con todos sus datos
function guardarCitaReagendada(citaOriginal, nuevaFecha) {
    const citasReagendadas = getCitasReagendadas();

    // Crear copia de la cita con nueva fecha (usando hora local, no UTC)
    const nuevaCita = {
        ...citaOriginal,
        fecha: formatearFechaLocal(nuevaFecha),
        fechaTexto: nuevaFecha.toLocaleDateString('es-DO', { day: 'numeric', month: 'long' }),
        esReagendada: true,
        citaOriginalId: generarCitaId(citaOriginal)
    };

    citasReagendadas.push(nuevaCita);
    localStorage.setItem('citasReagendadasData', JSON.stringify(citasReagendadas));
}

function reagendarCita(citaId) {
    // Buscar la cita original en Google Sheets data
    let citaOriginal = todasLasCitas.find(c => generarCitaId(c) === citaId);

    // Si no está en todasLasCitas, buscar en citas reagendadas
    if (!citaOriginal) {
        const citasReagendadas = getCitasReagendadas();
        citaOriginal = citasReagendadas.find(c => generarCitaId(c) === citaId);
    }

    if (!citaOriginal) {
        showToast('No se pudo encontrar la cita original', 'error');
        return;
    }

    openDatePicker(new Date(), (nuevaFecha) => {
        // Marcar la cita original como reagendada
        setCitaEstado(citaId, 'reagendada');

        // Guardar la cita con la nueva fecha
        guardarCitaReagendada(citaOriginal, nuevaFecha);

        showToast(`Cita reagendada para ${nuevaFecha.toLocaleDateString('es-DO')}`, 'success');
        if (document.getElementById('view-citas').classList.contains('active')) {
            cargarAgenda();
        } else {
            cargarDashboard();
        }
    });
}

function getInitials(nombre) {
    if (!nombre) return '?';
    return nombre.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

// ========================================
// Estadísticas
// ========================================

async function cargarEstadisticas() {
    if (todasLasCitas.length === 0) {
        todasLasCitas = await cargarDatosDeGoogle();
    }

    // Aplicar filtros activos
    const citasFiltradas = aplicarFiltros(todasLasCitas);

    // Calcular pacientes únicos por teléfono normalizado
    const pacientesMap = {};
    citasFiltradas.forEach(c => {
        const telefonoNorm = normalizarTelefono(c.telefono);
        if (telefonoNorm && telefonoNorm.length >= 7) {
            if (!pacientesMap[telefonoNorm]) {
                pacientesMap[telefonoNorm] = { nombre: c.paciente, telefono: c.telefono, citas: 1 };
            } else {
                pacientesMap[telefonoNorm].citas++;
            }
        }
    });
    const pacientes = Object.values(pacientesMap);
    const nuevos = pacientes.filter(p => p.citas === 1);
    const recurrentes = pacientes.filter(p => p.citas >= 2);

    // Actualizar contadores
    document.getElementById('stats-total-citas').textContent = citasFiltradas.length;
    document.getElementById('stats-total-pacientes').textContent = pacientes.length;
    document.getElementById('stats-nuevos').textContent = nuevos.length;
    document.getElementById('stats-recurrentes').textContent = recurrentes.length;

    // Calcular distribuciones
    const especialidades = contarOcurrencias(citasFiltradas, 'especialidad');
    const seguros = contarOcurrencias(citasFiltradas, 'tipoSeguro');
    const motivos = contarOcurrencias(citasFiltradas, 'motivoPrincipal');

    // Distribución de ARS (Solo seguros médicos)
    const arsStats = contarOcurrencias(
        citasFiltradas.filter(c => c.tipoSeguro === 'Seguro Médico'),
        'nombreArs'
    );

    // Renderizar gráficos interactivos (TODOS son clickeables ahora)
    renderizarBarrasInteractivas('chart-especialidades', especialidades, 'teal', 'especialidad');
    renderizarBarrasInteractivas('chart-seguro', seguros, 'coral', 'tipoSeguro');
    renderizarBarrasInteractivas('chart-ars', arsStats, 'blue', 'ars'); // Nuevo gráfico ARS
    renderizarBarrasInteractivas('chart-motivos', motivos.slice(0, 10), 'purple', 'motivo');

    // ========================================
    // Estadísticas Financieras (SOLO CITAS CONFIRMADAS)
    // ========================================

    // Filtrar solo citas confirmadas para cálculos financieros
    const citasConfirmadas = citasFiltradas.filter(c => {
        const citaId = generarCitaId(c);
        return getCitaEstado(citaId) === 'confirmada';
    });

    // Calcular ingresos totales (solo confirmadas)
    const ingresosTotales = citasConfirmadas.reduce((sum, c) => sum + (c.precio || 0), 0);
    const promedioPorCita = citasConfirmadas.length > 0 ? Math.round(ingresosTotales / citasConfirmadas.length) : 0;

    // Ingresos por tipo de seguro (solo confirmadas)
    const ingresosSeguro = citasConfirmadas.filter(c => c.tipoSeguro === 'Seguro Médico').reduce((sum, c) => sum + (c.precio || 0), 0);
    const ingresosPrivado = citasConfirmadas.filter(c => c.tipoSeguro === 'Privada').reduce((sum, c) => sum + (c.precio || 0), 0);

    // Actualizar tarjetas financieras con contador de citas confirmadas
    document.getElementById('stats-ingresos-totales').textContent = `RD$ ${formatearNumero(ingresosTotales)}`;
    document.getElementById('stats-promedio-cita').textContent = `RD$ ${formatearNumero(promedioPorCita)}`;
    document.getElementById('stats-ingresos-seguro').textContent = `RD$ ${formatearNumero(ingresosSeguro)}`;
    document.getElementById('stats-ingresos-privado').textContent = `RD$ ${formatearNumero(ingresosPrivado)}`;

    // Calcular ingresos por especialidad (solo confirmadas)
    const ingresosPorEspecialidad = calcularIngresosPorCampo(citasConfirmadas, 'especialidad');
    const ingresosPorSeguro = calcularIngresosPorCampo(citasConfirmadas, 'tipoSeguro');

    // Renderizar gráficos financieros (interactivos)
    renderizarBarrasIngresosInteractivas('chart-ingresos-especialidad', ingresosPorEspecialidad, 'green', 'especialidad');
    renderizarBarrasIngresosInteractivas('chart-ingresos-seguro', ingresosPorSeguro, 'blue', 'tipoSeguro');

    // Renderizar gráfico mensual (solo confirmadas)
    renderizarGraficoMensual(citasConfirmadas);

    // Mostrar/ocultar filtros activos
    actualizarUIFiltros();
}

// ========================================
// Filtros Interactivos
// ========================================

function aplicarFiltros(citas) {
    return citas.filter(c => {
        // Comparar especialidades limpiando emojis de ambos lados
        if (filtrosActivos.especialidad) {
            const filtroLimpio = limpiarEspecialidad(filtrosActivos.especialidad);
            const citaLimpia = limpiarEspecialidad(c.especialidad);
            if (!citaLimpia.includes(filtroLimpio) && !filtroLimpio.includes(citaLimpia)) return false;
        }
        if (filtrosActivos.tipoSeguro && c.tipoSeguro !== filtrosActivos.tipoSeguro) return false;
        if (filtrosActivos.mes && obtenerMesAnio(c.fechaTexto) !== filtrosActivos.mes) return false;
        // Filtrar por motivo de consulta
        if (filtrosActivos.motivo) {
            const motivoLower = (c.motivoPrincipal || '').toLowerCase();
            const filtroMotivo = filtrosActivos.motivo.toLowerCase();
            if (!motivoLower.includes(filtroMotivo) && !filtroMotivo.includes(motivoLower)) return false;
        }
        return true;
    });
}

function limpiarEspecialidad(esp) {
    return (esp || '').replace(/[❤️🩺]/g, '').trim().toLowerCase();
}

function toggleFiltro(campo, valor) {
    if (filtrosActivos[campo] === valor) {
        filtrosActivos[campo] = null; // Quitar filtro
    } else {
        filtrosActivos[campo] = valor; // Aplicar filtro
    }
    cargarEstadisticas();
}

function limpiarTodosFiltros() {
    filtrosActivos = { especialidad: null, tipoSeguro: null, mes: null, motivo: null };
    cargarEstadisticas();
}

function actualizarUIFiltros() {
    const container = document.getElementById('filtros-activos');
    const badges = document.getElementById('filtros-badges');

    const filtrosActivos_ = Object.entries(filtrosActivos).filter(([k, v]) => v !== null);

    if (filtrosActivos_.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    badges.innerHTML = filtrosActivos_.map(([campo, valor]) =>
        `<span class="filtro-badge">${campo}: ${valor}</span>`
    ).join('');
}

// Renderizar barras interactivas
function renderizarBarrasInteractivas(containerId, datos, colorClass, campo) {
    const container = document.getElementById(containerId);
    if (!container || datos.length === 0) {
        if (container) container.innerHTML = '<p class="empty-state">Sin datos disponibles</p>';
        return;
    }

    const maxValor = Math.max(...datos.map(d => d.cantidad));
    const filtroActivo = filtrosActivos[campo];

    container.innerHTML = datos.map(d => {
        const porcentaje = Math.max((d.cantidad / maxValor) * 100, 1); // Mínimo 1% para visibilidad
        const esActivo = filtroActivo === d.nombre;
        const esDimmed = filtroActivo && !esActivo;

        return `
            <div class="bar-item ${esActivo ? 'active' : ''} ${esDimmed ? 'dimmed' : ''}"
                 onclick="toggleFiltro('${campo}', '${d.nombre.replace(/'/g, "\\'")}')">
                <span class="bar-label" title="${d.nombre}">${truncar(d.nombre, 25)}</span>
                <div class="bar-container">
                    <div class="chart-bar-fill ${colorClass}" style="width: ${porcentaje}%"></div>
                </div>
                <span class="bar-count">${d.cantidad}</span>
            </div>
        `;
    }).join('');
}

// Renderizar barras simples (no interactivas)
function renderizarBarras(containerId, datos, colorClass) {
    const container = document.getElementById(containerId);
    if (!container || datos.length === 0) {
        if (container) container.innerHTML = '<p class="empty-state">Sin datos disponibles</p>';
        return;
    }

    const maxValor = Math.max(...datos.map(d => d.cantidad));

    container.innerHTML = datos.map(d => {
        const porcentaje = Math.max((d.cantidad / maxValor) * 100, 1);
        return `
            <div class="bar-item">
                <span class="bar-label" title="${d.nombre}">${truncar(d.nombre, 25)}</span>
                <div class="bar-container">
                    <div class="chart-bar-fill ${colorClass}" style="width: ${porcentaje}%"></div>
                </div>
                <span class="bar-count">${d.cantidad}</span>
            </div>
        `;
    }).join('');
}

// Renderizar barras de ingresos (financieras)
function renderizarBarrasIngresos(containerId, datos, colorClass) {
    const container = document.getElementById(containerId);
    if (!container || datos.length === 0) {
        if (container) container.innerHTML = '<p class="empty-state">Sin datos disponibles</p>';
        return;
    }

    const maxValor = Math.max(...datos.map(d => d.cantidad));

    container.innerHTML = datos.map(d => {
        const porcentaje = Math.max((d.cantidad / maxValor) * 100, 1);
        return `
            <div class="bar-item">
                <span class="bar-label" title="${d.nombre}">${truncar(d.nombre, 20)}</span>
                <div class="bar-container">
                    <div class="chart-bar-fill ${colorClass}" style="width: ${porcentaje}%"></div>
                </div>
                <span class="bar-count">RD$ ${formatearNumero(d.cantidad)}</span>
            </div>
        `;
    }).join('');
}

// Renderizar barras de ingresos interactivas (clickeables)
function renderizarBarrasIngresosInteractivas(containerId, datos, colorClass, campo) {
    const container = document.getElementById(containerId);
    if (!container || datos.length === 0) {
        if (container) container.innerHTML = '<p class="empty-state">Sin ingresos confirmados</p>';
        return;
    }

    const maxValor = Math.max(...datos.map(d => d.cantidad));
    const filtroActivo = filtrosActivos[campo];

    container.innerHTML = datos.map(d => {
        const porcentaje = Math.max((d.cantidad / maxValor) * 100, 1);
        const esActivo = filtroActivo === d.nombre;
        const esDimmed = filtroActivo && !esActivo;

        return `
            <div class="bar-item ${esActivo ? 'active' : ''} ${esDimmed ? 'dimmed' : ''}"
                 onclick="toggleFiltro('${campo}', '${d.nombre.replace(/'/g, "\\'")}')"
                 style="cursor: pointer;">
                <span class="bar-label" title="${d.nombre}">${truncar(d.nombre, 20)}</span>
                <div class="bar-container">
                    <div class="chart-bar-fill ${colorClass}" style="width: ${porcentaje}%"></div>
                </div>
                <span class="bar-count">RD$ ${formatearNumero(d.cantidad)}</span>
            </div>
        `;
    }).join('');
}

// Gráfico de ingresos mensuales
function renderizarGraficoMensual(citas) {
    const container = document.getElementById('chart-ingresos-mensuales');
    if (!container) return;

    // Agrupar por mes
    const meses = {};
    citas.forEach(c => {
        const mesAnio = obtenerMesAnio(c.fechaTexto);
        if (!mesAnio) return;

        if (!meses[mesAnio]) {
            meses[mesAnio] = {
                cardiologia_seguro: 0,
                cardiologia_privado: 0,
                pediatria_seguro: 0,
                pediatria_privado: 0,
                otros: 0
            };
        }

        const espLower = limpiarEspecialidad(c.especialidad);
        const esSeguro = c.tipoSeguro === 'Seguro Médico';

        if (espLower.includes('cardio')) {
            if (esSeguro) meses[mesAnio].cardiologia_seguro += c.precio || 0;
            else meses[mesAnio].cardiologia_privado += c.precio || 0;
        } else if (espLower.includes('pediatr')) {
            if (esSeguro) meses[mesAnio].pediatria_seguro += c.precio || 0;
            else meses[mesAnio].pediatria_privado += c.precio || 0;
        } else {
            meses[mesAnio].otros += c.precio || 0;
        }
    });

    // Ordenar meses
    const mesesOrdenados = Object.entries(meses).sort((a, b) => {
        const [mesA, anioA] = a[0].split('/');
        const [mesB, anioB] = b[0].split('/');
        return new Date(anioA, mesA - 1) - new Date(anioB, mesB - 1);
    });

    if (mesesOrdenados.length === 0) {
        container.innerHTML = '<p class="empty-state">Sin datos mensuales</p>';
        return;
    }

    const maxTotal = Math.max(...mesesOrdenados.map(([_, v]) =>
        v.cardiologia_seguro + v.cardiologia_privado + v.pediatria_seguro + v.pediatria_privado + v.otros
    ));

    const nombressMeses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    // Crear líneas de guía para la grilla
    const lineasGuia = [0, 25, 50, 75, 100].map(pct =>
        `<div class="chart-grid-line" style="bottom: ${pct}%"></div>`
    ).join('');

    container.innerHTML = `
        <div class="chart-monthly-container" style="height: 320px;">
            ${lineasGuia}
            <div class="chart-monthly-bars" style="display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; height: 100%; position: relative; z-index: 2;">
                ${mesesOrdenados.map(([mesAnio, v]) => {
        const [mes, anio] = mesAnio.split('/');
        const total = v.cardiologia_seguro + v.cardiologia_privado + v.pediatria_seguro + v.pediatria_privado + v.otros;
        // Altura base del 95% para maximizar uso
        const altura = Math.max((total / maxTotal) * 95, 4);

        // Cálculo de alturas relativas
        const h_cs = (v.cardiologia_seguro / total) * 100;
        const h_cp = (v.cardiologia_privado / total) * 100;
        const h_ps = (v.pediatria_seguro / total) * 100;
        const h_pp = (v.pediatria_privado / total) * 100;
        const h_otro = (v.otros / total) * 100;

        return `
                        <div class="month-column" onclick="toggleFiltro('mes', '${mesAnio}')" 
                             style="cursor: pointer; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%;">
                            
                            <div class="month-bar-tooltip">
                                <div style="font-weight: 700; font-size: 12px; margin-bottom: 2px;">RD$ ${formatearNumero(total)}</div>
                                <div style="opacity: 0.8; font-size: 10px;">${nombressMeses[parseInt(mes) - 1]} ${anio}</div>
                            </div>
                            
                            <div class="month-bar-stack" style="height: ${altura}%; width: 100%; max-width: 48px; border-radius: 8px 8px 4px 4px; overflow: hidden; display: flex; flex-direction: column-reverse;">
                                ${v.cardiologia_seguro > 0 ? `<div class="month-segment cardiologia-seguro" style="height: ${h_cs}%"></div>` : ''}
                                ${v.cardiologia_privado > 0 ? `<div class="month-segment cardiologia-privado" style="height: ${h_cp}%"></div>` : ''}
                                ${v.pediatria_seguro > 0 ? `<div class="month-segment pediatria-seguro" style="height: ${h_ps}%"></div>` : ''}
                                ${v.pediatria_privado > 0 ? `<div class="month-segment pediatria-privado" style="height: ${h_pp}%"></div>` : ''}
                                ${v.otros > 0 ? `<div class="month-segment otros" style="height: ${h_otro}%"></div>` : ''}
                            </div>
                            
                            <span class="month-label">${nombressMeses[parseInt(mes) - 1]}</span>
                        </div>
                    `;
    }).join('')}
            </div>
        </div>
        </div>

        <div class="chart-legend" style="margin-top: 10px; justify-content: center;">
            <div class="legend-item"><span class="legend-color cardiologia-seguro"></span>Cardiología Seguro</div>
            <div class="legend-item"><span class="legend-color cardiologia-privado"></span>Cardiología Privado</div>
            <div class="legend-item"><span class="legend-color pediatria-privado"></span>Pediatría Privado</div>
            <div class="legend-item"><span class="legend-color otros"></span>Otros</div>
    `;
}

function obtenerMesAnio(fechaTexto) {
    if (!fechaTexto) return null;

    // Formato: "12 de junio" o "12/6/2025"
    const meses = {
        'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4,
        'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8,
        'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12
    };

    // Intentar formato "X de MES"
    const matchTexto = fechaTexto.toLowerCase().match(/\d+\s+de\s+(\w+)/);
    if (matchTexto) {
        const mesNum = meses[matchTexto[1]];
        if (mesNum) return `${mesNum}/2025`;
    }

    // Intentar formato "DD/MM/YYYY"
    const matchNum = fechaTexto.match(/(\d+)\/(\d+)\/(\d+)/);
    if (matchNum) {
        return `${parseInt(matchNum[2])}/${matchNum[3]}`;
    }

    return null;
}

// Event listener para limpiar filtros
document.getElementById('btn-limpiar-filtros')?.addEventListener('click', limpiarTodosFiltros);

// Normalizar tipo de seguro - agrupar variaciones similares
function normalizarTipoSeguro(valor) {
    if (!valor) return 'No especificado';

    const valorLower = valor.toLowerCase().trim();

    // Agrupar variaciones de "Privada"
    if (valorLower.includes('privad') ||
        valorLower.includes('particular') ||
        valorLower.includes('pago directo') ||
        valorLower === 'privada' ||
        valorLower === 'privado') {
        return 'Privada';
    }

    // Agrupar variaciones de "Seguro Médico"
    if (valorLower.includes('seguro') ||
        valorLower.includes('ars') ||
        valorLower.includes('aseguradora') ||
        valorLower.includes('médico') ||
        valorLower.includes('medico')) {
        return 'Seguro Médico';
    }

    return 'Otro';
}

// Normalizar especialidad - separar combinaciones incorrectas
function normalizarEspecialidad(valor) {
    if (!valor) return 'No especificado';

    const valorLower = valor.toLowerCase().trim();

    // Si contiene ambas, elegir la principal basada en el contexto de cardiología pediátrica
    if (valorLower.includes('cardio') && valorLower.includes('pediatr')) {
        return 'Cardiología Pediátrica'; // Esta ES la especialidad correcta de la doctora
    }

    // Normalizar variaciones de Cardiología
    if (valorLower.includes('cardio')) {
        return 'Cardiología';
    }

    // Normalizar variaciones de Pediatría
    if (valorLower.includes('pediatr')) {
        return 'Pediatría';
    }

    return valor.trim();
}

// Contar con normalización
function contarOcurrenciasNormalizadas(datos, campo, normalizador) {
    const conteo = {};
    datos.forEach(d => {
        const valorOriginal = d[campo] || 'No especificado';
        const valorNormalizado = normalizador(valorOriginal);
        conteo[valorNormalizado] = (conteo[valorNormalizado] || 0) + 1;
    });

    return Object.entries(conteo)
        .map(([nombre, cantidad]) => ({ nombre, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad);
}

function contarOcurrencias(datos, campo) {
    const conteo = {};
    datos.forEach(d => {
        const valor = d[campo] || 'No especificado';
        conteo[valor] = (conteo[valor] || 0) + 1;
    });

    // Convertir a array y ordenar
    return Object.entries(conteo)
        .map(([nombre, cantidad]) => ({ nombre, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad);
}

// (Funciones duplicadas eliminadas)

// Helper Functions
function truncar(texto, maxLength) {
    if (!texto) return '';
    if (texto.length <= maxLength) return texto;
    return texto.substring(0, maxLength) + '...';
}

function formatearNumero(numero) {
    return numero.toLocaleString('es-DO');
}

function calcularIngresosPorCampo(datos, campo) {
    const ingresos = {};
    datos.forEach(d => {
        const valor = d[campo] || 'No especificado';
        ingresos[valor] = (ingresos[valor] || 0) + (d.precio || 0);
    });

    return Object.entries(ingresos)
        .map(([nombre, cantidad]) => ({ nombre, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad);
}

// Event listener para el botón de actualizar estadísticas
document.getElementById('btn-refresh-stats')?.addEventListener('click', async () => {
    todasLasCitas = [];
    await cargarEstadisticas();
});

// ========================================
// Toast Notification System
// ========================================
function showToast(message, type = 'info', title = null, duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };

    const titles = {
        success: 'Éxito',
        error: 'Error',
        warning: 'Advertencia',
        info: 'Información'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <div class="toast-content">
            <div class="toast-title">${title || titles[type] || titles.info}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">×</button>
    `;

    container.appendChild(toast);

    // Auto-remove after duration
    setTimeout(() => {
        toast.style.animation = 'toastSlideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ========================================
// Confirm Modal System
// ========================================
let confirmResolve = null;

function showConfirm(message, title = 'Confirmar Acción') {
    return new Promise((resolve) => {
        confirmResolve = resolve;

        document.getElementById('confirm-modal-title').textContent = title;
        document.getElementById('confirm-modal-message').textContent = message;
        document.getElementById('confirm-modal').style.display = 'flex';
    });
}

document.getElementById('confirm-modal-ok')?.addEventListener('click', () => {
    document.getElementById('confirm-modal').style.display = 'none';
    if (confirmResolve) confirmResolve(true);
});

document.getElementById('confirm-modal-cancel')?.addEventListener('click', () => {
    document.getElementById('confirm-modal').style.display = 'none';
    if (confirmResolve) confirmResolve(false);
});

document.getElementById('confirm-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'confirm-modal') {
        document.getElementById('confirm-modal').style.display = 'none';
        if (confirmResolve) confirmResolve(false);
    }
});

// ========================================
// Date Picker Modal System
// ========================================
let dpCurrentMonth = new Date().getMonth();
let dpCurrentYear = new Date().getFullYear();
let dpSelectedDate = null;
let dpCallback = null;

function openDatePicker(initialDate, callback) {
    dpSelectedDate = initialDate ? new Date(initialDate) : new Date();
    dpCurrentMonth = dpSelectedDate.getMonth();
    dpCurrentYear = dpSelectedDate.getFullYear();
    dpCallback = callback;

    renderCalendar();
    document.getElementById('datepicker-modal').style.display = 'flex';
}

function closeDatePicker() {
    document.getElementById('datepicker-modal').style.display = 'none';
}

function renderCalendar() {
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    document.getElementById('dp-month-year').textContent = `${monthNames[dpCurrentMonth]} ${dpCurrentYear}`;

    const daysContainer = document.getElementById('dp-days');
    daysContainer.innerHTML = '';

    const firstDay = new Date(dpCurrentYear, dpCurrentMonth, 1).getDay();
    const daysInMonth = new Date(dpCurrentYear, dpCurrentMonth + 1, 0).getDate();
    const today = new Date();

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
        const emptyBtn = document.createElement('button');
        emptyBtn.className = 'dp-day empty';
        daysContainer.appendChild(emptyBtn);
    }

    // Days of month
    for (let d = 1; d <= daysInMonth; d++) {
        const dayBtn = document.createElement('button');
        dayBtn.className = 'dp-day';
        dayBtn.textContent = d;

        const thisDate = new Date(dpCurrentYear, dpCurrentMonth, d);

        // Today
        if (d === today.getDate() && dpCurrentMonth === today.getMonth() && dpCurrentYear === today.getFullYear()) {
            dayBtn.classList.add('today');
        }

        // Selected
        if (dpSelectedDate && d === dpSelectedDate.getDate() &&
            dpCurrentMonth === dpSelectedDate.getMonth() && dpCurrentYear === dpSelectedDate.getFullYear()) {
            dayBtn.classList.add('selected');
        }

        dayBtn.addEventListener('click', () => {
            const selected = new Date(dpCurrentYear, dpCurrentMonth, d);
            closeDatePicker();
            if (dpCallback) dpCallback(selected);
        });

        daysContainer.appendChild(dayBtn);
    }
}

// Date Picker Navigation
document.getElementById('dp-prev-month')?.addEventListener('click', () => {
    dpCurrentMonth--;
    if (dpCurrentMonth < 0) {
        dpCurrentMonth = 11;
        dpCurrentYear--;
    }
    renderCalendar();
});

document.getElementById('dp-next-month')?.addEventListener('click', () => {
    dpCurrentMonth++;
    if (dpCurrentMonth > 11) {
        dpCurrentMonth = 0;
        dpCurrentYear++;
    }
    renderCalendar();
});

document.getElementById('dp-today')?.addEventListener('click', () => {
    const today = new Date();
    closeDatePicker();
    if (dpCallback) dpCallback(today);
});

document.getElementById('dp-cancel')?.addEventListener('click', closeDatePicker);

document.getElementById('datepicker-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'datepicker-modal') closeDatePicker();
});

// ========================================
// Replace Native Date Picker with Custom Modal
// ========================================
// Hide native input and make date-display clickable
document.addEventListener('DOMContentLoaded', () => {
    const nativeInput = document.getElementById('fecha-picker');
    if (nativeInput) {
        nativeInput.style.display = 'none';
    }

    const dateDisplay = document.querySelector('.date-display');
    if (dateDisplay) {
        dateDisplay.style.cursor = 'pointer';
        dateDisplay.addEventListener('click', (e) => {
            // Don't trigger if clicking buttons inside
            if (e.target.tagName === 'BUTTON') return;

            openDatePicker(fechaSeleccionada, (newDate) => {
                fechaSeleccionada = newDate;
                cargarAgenda();
            });
        });
    }
});

// ========================================
// Nuevas Funcionalidades
// ========================================

// ========================================
// Dark Mode Toggle
// ========================================
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDark);

    const btn = document.getElementById('btn-dark-mode');
    if (btn) {
        btn.textContent = isDark ? '☀️' : '🌙';
    }
}

// Restaurar preferencia de tema al cargar
document.addEventListener('DOMContentLoaded', () => {
    const savedDarkMode = localStorage.getItem('darkMode') === 'true';
    if (savedDarkMode) {
        document.body.classList.add('dark-mode');
        const btn = document.getElementById('btn-dark-mode');
        if (btn) btn.textContent = '☀️';
    }
});

document.getElementById('btn-dark-mode')?.addEventListener('click', toggleDarkMode);

// ========================================
// Global Search
// ========================================
document.getElementById('global-search')?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    const dropdown = document.getElementById('global-search-results');

    if (query.length < 2) {
        dropdown.classList.remove('active');
        return;
    }

    const resultados = todosPacientes.filter(p =>
        p.nombre.toLowerCase().includes(query) ||
        p.telefono.includes(query)
    ).slice(0, 8); // Máximo 8 resultados

    if (resultados.length === 0) {
        dropdown.innerHTML = '<div class="search-result-item"><span class="result-info">No se encontraron resultados</span></div>';
    } else {
        dropdown.innerHTML = resultados.map(p => `
            <div class="search-result-item" onclick="mostrarHistorialPaciente('${obtenerIdPaciente(p)}')">
                <div class="result-avatar">${getInitials(p.nombre)}</div>
                <div class="result-info">
                    <div class="result-name">${p.nombre}</div>
                    <div class="result-phone">📞 ${p.telefono} • ${p.citas} cita${p.citas !== 1 ? 's' : ''}</div>
                </div>
            </div>
        `).join('');
    }

    dropdown.classList.add('active');
});

// Cerrar dropdown al hacer clic fuera
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('global-search-results');
    const search = document.getElementById('global-search');
    if (dropdown && !dropdown.contains(e.target) && e.target !== search) {
        dropdown.classList.remove('active');
    }
});

// ========================================
// Print Agenda
// ========================================
document.getElementById('btn-print-agenda')?.addEventListener('click', () => {
    window.print();
    showToast('Preparando impresión...', 'info');
});

// ========================================
// Notas en Citas
// ========================================
function getCitaNotas(citaId) {
    const notas = localStorage.getItem('citasNotas');
    if (!notas) return '';
    const notasObj = JSON.parse(notas);
    return notasObj[citaId] || '';
}

function setCitaNotas(citaId, nota) {
    const notas = localStorage.getItem('citasNotas');
    const notasObj = notas ? JSON.parse(notas) : {};
    notasObj[citaId] = nota;
    localStorage.setItem('citasNotas', JSON.stringify(notasObj));
}

function agregarNota(citaId) {
    const notaExistente = getCitaNotas(citaId);

    const modal = document.getElementById('note-modal');
    if (modal) {
        document.getElementById('note-cita-id').value = citaId;
        document.getElementById('note-input').value = notaExistente;
        modal.style.display = 'flex';
        setTimeout(() => {
            const input = document.getElementById('note-input');
            if (input) input.focus();
        }, 100);
    } else {
        alert('Error: Modal de notas no encontrado. Por favor recargue la página.');
    }
}

function cerrarModalNota() {
    const modal = document.getElementById('note-modal');
    if (modal) modal.style.display = 'none';
}

function guardarNotaModal() {
    const citaId = document.getElementById('note-cita-id').value;
    const nuevaNota = document.getElementById('note-input').value;

    setCitaNotas(citaId, nuevaNota);
    showToast('Nota guardada correctamente', 'success');
    cerrarModalNota();

    // Recargar vista
    if (document.getElementById('view-citas').classList.contains('active')) {
        cargarAgenda();
    } else {
        cargarDashboard();
    }
}

// Helper para obtener ID seguro (Telefone o Nombre)
function obtenerIdPaciente(cita) {
    if (!cita) return '';
    const telNorm = normalizarTelefono(cita.telefono);
    // Si tiene teléfono válido (>=6 dígitos), usadlo. Si no, usar nombre.
    // Esto evita que "20" (un dato sucio) agrupe a Luis y Pedro.
    if (telNorm && telNorm.length >= 6) {
        return telNorm;
    }
    // Fallback: Nombre completo (remover comillas por seguridad html)
    // Soporte para objetos 'cita' (paciente) y 'paciente Resumen' (nombre)
    const nombre = cita.paciente || cita.nombre || '';
    return nombre.replace(/['"]/g, '');
}

// ========================================
// Historial de Paciente
// ========================================
function mostrarHistorialPaciente(identificador) {
    if (!identificador) return;
    const idStr = String(identificador).toLowerCase().trim();

    // Determinar estrategia de búsqueda
    // Si son solo dígitos Y largo >=6, es búsqueda exacta por teléfono.
    // Si no, es búsqueda por nombre.
    const esBusquedaPorTelefono = /^\d+$/.test(idStr) && idStr.length >= 6;

    // Estrategia de búsqueda refinada (Two-Pass)
    let citasFiltradas = [];

    if (esBusquedaPorTelefono) {
        // Búsqueda exacta por teléfono
        citasFiltradas = todasLasCitas.filter(c => normalizarTelefono(c.telefono) === idStr);
    } else {
        // Búsqueda por Nombre (Prioridad Exacta vs Parcial)

        // Paso 1: Intentar Exact Match (Luis === Luis)
        const exactMatches = todasLasCitas.filter(c => c.paciente.toLowerCase() === idStr);

        if (exactMatches.length > 0) {
            // Si encontramos al paciente exacto, ignoramos los parciales (Luis ignora a Luisa)
            citasFiltradas = exactMatches;
        } else {
            // Paso 2: Fallback a Parcial (para el buscador global "Lui...")
            citasFiltradas = todasLasCitas.filter(c => c.paciente.toLowerCase().includes(idStr));
        }
    }

    const citasPaciente = citasFiltradas; // Alias para compatibilidad con resto de fn

    if (citasPaciente.length === 0) {
        showToast('No se encontró historial con ese criterio', 'warning');
        return;
    }

    // Obtener nombre del paciente (el más largo para display)
    const nombrePaciente = citasPaciente.reduce((longest, c) =>
        c.paciente.length > longest.length ? c.paciente : longest
        , '');

    // Ordenar por fecha (más reciente primero)
    citasPaciente.sort((a, b) => {
        if (!a.fecha || !b.fecha) return 0;
        return b.fecha - a.fecha;
    });

    // Crear modal
    let modal = document.getElementById('modal-historial');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-historial';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
    }

    // Calcular resumen
    const totalCitas = citasPaciente.length;
    const ultimoTel = citasPaciente[0].telefono;

    modal.innerHTML = `
        <div class="modal-content history-modal-content">
            <div class="modal-header">
                <h3>📋 Historial de ${nombrePaciente}</h3>
                <button class="modal-close" onclick="cerrarModalHistorial()">×</button>
            </div>
            <div class="modal-body">
                <p style="margin-bottom: 16px; color: var(--text-gray);">
                    🔍 Criterio: ${esBusquedaPorTelefono ? 'Teléfono' : 'Nombre'} • 📞 ${ultimoTel} • <strong>${totalCitas}</strong> cita${totalCitas !== 1 ? 's' : ''}
                </p>
                <div class="history-list">
                    ${citasPaciente.map(c => {
        const citaId = generarCitaId(c);
        const estado = getCitaEstado(citaId);
        const notas = getCitaNotas(citaId);
        const estadoInfo = c.estado === 'cancelada' ? '❌ Cancelada' : (estado === 'confirmada' ? '✅ Confirmada' : '⏳ Pendiente');

        return `
                            <div class="history-item">
                                <div class="history-date">📅 ${c.fechaTexto || 'Sin fecha'}</div>
                                <div class="history-details">
                                    🩺 ${c.especialidad} • 📋 ${c.motivoPrincipal} • 💳 ${c.tipoSeguro}
                                    <br>Estado: <strong>${estado}</strong>
                                    ${notas ? `<br>📝 <em>${notas}</em>` : ''}
                                </div>
                            </div>
                        `;
    }).join('')}
                </div>
            </div>
        </div>
    `;

    modal.style.display = 'flex';

    // Cerrar al hacer clic fuera
    modal.addEventListener('click', (e) => {
        if (e.target === modal) cerrarModalHistorial();
    });
}

function cerrarModalHistorial() {
    const modal = document.getElementById('modal-historial');
    if (modal) modal.style.display = 'none';
}

// ========================================
// Completar Cita
// ========================================
function completarCita(citaId) {
    setCitaEstado(citaId, 'completada');
    showToast('Cita marcada como completada', 'success');
    if (document.getElementById('view-citas').classList.contains('active')) {
        cargarAgenda();
    } else {
        cargarDashboard();
    }
}

// ========================================
// Push Notifications System
// ========================================
let citasCountAnterior = 0;
let notificacionesActivas = true;

// Solicitar permisos de notificación al cargar
function solicitarPermisosNotificacion() {
    if ('Notification' in window) {
        if (Notification.permission === 'default') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    showToast('Notificaciones activadas', 'success');
                }
            });
        }
    }
}

// Mostrar notificación de nuevas citas
function mostrarNotificacionNuevasCitas(cantidad) {
    // Notificación del navegador
    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification('🩺 Sistema Médico', {
            body: `${cantidad} nueva${cantidad > 1 ? 's' : ''} cita${cantidad > 1 ? 's' : ''} registrada${cantidad > 1 ? 's' : ''}`,
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🏥</text></svg>',
            tag: 'nuevas-citas',
            requireInteraction: false
        });

        notification.onclick = () => {
            window.focus();
            notification.close();
        };

        setTimeout(() => notification.close(), 5000);
    }

    // Banner visual en la app
    mostrarBannerNotificacion(`🔔 ${cantidad} nueva${cantidad > 1 ? 's' : ''} cita${cantidad > 1 ? 's' : ''} registrada${cantidad > 1 ? 's' : ''}`);
}

// Banner de notificación visual
function mostrarBannerNotificacion(mensaje) {
    // Remover banner existente si hay
    const bannerExistente = document.querySelector('.notification-banner');
    if (bannerExistente) bannerExistente.remove();

    const banner = document.createElement('div');
    banner.className = 'notification-banner';
    banner.innerHTML = `
        <div class="notification-text">
            <span>${mensaje}</span>
        </div>
        <button class="notification-close" onclick="this.parentElement.remove()">×</button>
    `;

    document.body.appendChild(banner);

    // Auto-cerrar después de 8 segundos
    setTimeout(() => {
        if (banner.parentElement) {
            banner.style.animation = 'slideDown 0.3s ease-out reverse';
            setTimeout(() => banner.remove(), 300);
        }
    }, 8000);
}

// Verificar nuevas citas durante sincronización
function verificarNuevasCitas(citasActuales) {
    const cantidadActual = citasActuales.length;

    if (citasCountAnterior > 0 && cantidadActual > citasCountAnterior) {
        const nuevas = cantidadActual - citasCountAnterior;
        if (notificacionesActivas) {
            mostrarNotificacionNuevasCitas(nuevas);
        }
    }

    citasCountAnterior = cantidadActual;
}

// Solicitar permisos cuando se muestra la app
document.addEventListener('DOMContentLoaded', () => {
    // Retrasar para no molestar inmediatamente
    setTimeout(() => {
        if (sessionStorage.getItem('usuario')) {
            solicitarPermisosNotificacion();
        }
    }, 3000);
});

// ========================================
// Initialize Lucide Icons
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide icons if available
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
});

// ========================================
// Seguridad y Exposición Global
// ========================================

// 1. Limpieza de credenciales antiguas (seguridad)
try {
    if (localStorage.getItem('usuario')) {
        localStorage.removeItem('usuario');
        console.log('Credenciales antiguas eliminadas por seguridad');
    }
} catch (e) { console.error(e); }

// 2. Exponer funciones al objeto Window
window.toggleDarkMode = toggleDarkMode;
window.agregarNota = agregarNota;
window.mostrarHistorialPaciente = mostrarHistorialPaciente;
window.completarCita = completarCita;
window.confirmarCita = confirmarCita;
window.cancelarCita = cancelarCita;
window.reagendarCita = reagendarCita;
window.cerrarModalNota = cerrarModalNota;
window.guardarNotaModal = guardarNotaModal;

// ========================================
// Centro de Notificaciones (Citas Recientes)
// ========================================

const btnNotif = document.getElementById('btn-notifications');
const modalNotif = document.getElementById('notifications-modal');
const badgeNotif = document.getElementById('badge-notifications');

if (btnNotif) {
    btnNotif.addEventListener('click', () => {
        mostrarNotificaciones();
        localStorage.setItem('lastNotificationCheck', new Date().toISOString());
        if (badgeNotif) badgeNotif.style.display = 'none';
    });
}

function cerrarModalNotificaciones() {
    if (modalNotif) modalNotif.style.display = 'none';
}

window.cerrarModalNotificaciones = cerrarModalNotificaciones;

function mostrarNotificaciones() {
    // Usamos el orden del CSV invertido (LIFO) como verdad absoluta de "reciente"
    // Esto evita problemas si el timestamp falla al parsearse
    let citasOrdenadas = [...todasLasCitas].reverse();

    const topCitas = citasOrdenadas.slice(0, 20); // Mostrar últimas 20
    const container = document.getElementById('lista-notificaciones');

    if (topCitas.length === 0) {
        container.innerHTML = '<p class="empty-state">No hay citas registradas</p>';
        if (modalNotif) modalNotif.style.display = 'flex';
        return;
    }

    const lastCheckStr = localStorage.getItem('lastNotificationCheck');
    // Si es la primera vez (null), asumir que todo es "visto" o solo mostrar lista sin resaltar excesivamente
    // O mejor: usar Date(0) para resaltar todo como nuevo si nunca ha entrado.
    const lastCheck = lastCheckStr ? new Date(lastCheckStr) : new Date(0);

    container.innerHTML = topCitas.map(cita => {
        // Es nueva si su fecha de creación es posterior a la última revisión
        // Si no tiene fecha de creación (csv viejo), no podemos saber, asumimos falso para no molestar
        const esNueva = cita.creadoEn && cita.creadoEn > lastCheck;

        const highlightStyle = esNueva ? 'background-color: #e8f8f5; border-left: 4px solid #1abc9c;' : '';

        return `
            <div class="notification-item" onclick="mostrarHistorialPaciente('${obtenerIdPaciente(cita)}')" style="padding: 12px; margin-bottom: 8px; border-bottom: 1px solid var(--border); border-radius: 4px; ${highlightStyle} cursor: pointer;" title="Ver historial">
                <div style="display:flex; justify-content:space-between; align-items: flex-start; margin-bottom: 4px;">
                    <strong style="color: var(--text-dark);">${cita.paciente}</strong>
                    ${esNueva ? '<span style="font-size:0.7em; background:var(--teal); color:white; padding:2px 6px; border-radius:10px; font-weight:bold;">NUEVA</span>' : ''}
                </div>
                <div style="font-size:0.9em; color:var(--text-gray); margin-bottom: 2px;">
                    📅 <strong>Fecha Cita:</strong> ${cita.fechaTexto}
                </div>
                 <div style="font-size:0.9em; color:var(--text-gray); margin-bottom: 2px;">
                    🩺 ${cita.especialidad}
                </div>
                <div style="font-size:0.85em; color: var(--text-light);">
                    📝 ${cita.motivoPrincipal}
                </div>
                <div style="font-size:0.75em; color:var(--text-light); text-align: right; margin-top: 5px;">
                     Ingresado: ${cita.creadoEnTexto || 'Fecha desconocida'}
                </div>
            </div>
        `;
    }).join('');

    if (modalNotif) modalNotif.style.display = 'flex';
}

function verificarAlertasBadge() {
    const lastCheckStr = localStorage.getItem('lastNotificationCheck');
    const lastCheck = lastCheckStr ? new Date(lastCheckStr) : new Date(0);

    const hayNuevas = todasLasCitas.some(c => c.creadoEn && c.creadoEn > lastCheck);

    if (badgeNotif) {
        badgeNotif.style.display = hayNuevas ? 'block' : 'none';
    }
}

// ========================================
// Búsqueda Global (Header Omnibox)
// ========================================
const globalSearchInput = document.getElementById('global-search');
const globalSearchResults = document.getElementById('global-search-results');

if (globalSearchInput && globalSearchResults) {
    globalSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();

        if (query.length < 2) {
            globalSearchResults.style.display = 'none';
            return;
        }

        const pacientesUnicosMap = new Map();
        todasLasCitas.forEach(c => {
            const nombreMatch = c.paciente.toLowerCase().includes(query);
            const telMatch = c.telefono && c.telefono.replace(/\D/g, '').includes(query);

            if (nombreMatch || telMatch) {
                if (!pacientesUnicosMap.has(c.paciente)) {
                    pacientesUnicosMap.set(c.paciente, c);
                }
            }
        });

        const resultados = Array.from(pacientesUnicosMap.values()).slice(0, 8); // Top 8

        if (resultados.length > 0) {
            globalSearchResults.innerHTML = resultados.map(r => `
                <div class="search-result-item" onclick="mostrarHistorialPaciente('${r.paciente}'); document.getElementById('global-search-results').style.display='none'; document.getElementById('global-search').value='';" style="padding: 12px; cursor: pointer; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight: 600; color: var(--text-dark);">${r.paciente}</div>
                        <div style="font-size: 0.85em; color: var(--text-light);">📞 ${r.telefono}</div>
                    </div>
                    <div style="font-size: 1.2em;">➡️</div>
                </div>
            `).join('');
            globalSearchResults.style.display = 'block';
        } else {
            globalSearchResults.innerHTML = '<div style="padding: 12px; color: var(--text-gray); text-align: center;">No se encontraron resultados</div>';
            globalSearchResults.style.display = 'block';
        }
    });

    // Cerrar al clic fuera
    document.addEventListener('click', (e) => {
        if (!globalSearchInput.contains(e.target) && !globalSearchResults.contains(e.target)) {
            globalSearchResults.style.display = 'none';
        }
    });
}

// ========================================
// SISTEMA DE AUDITORÍA Y CANCELACIÓN
// ========================================

function cerrarModalCancelacion() {
    citaCancelacionId = null;
    const modal = document.getElementById('modal-cancelacion');
    if (modal) modal.style.display = 'none';
}

function confirmarCancelacionFinal() {
    const motivoSelect = document.getElementById('motivo-cancelacion');
    const notaInput = document.getElementById('nota-cancelacion');
    const motivo = motivoSelect.value;
    const nota = notaInput.value;

    if (!motivo) {
        showToast('Debes seleccionar un motivo obligatoriamente', 'error');
        motivoSelect.focus();
        return;
    }

    if (citaCancelacionId) {
        // Ejecutar cancelación
        setCitaEstado(citaCancelacionId, 'cancelada');

        // Registrar Log detallado
        registrarAuditoria('Cancelar Cita', `Motivo: ${motivo}. Detalles: ${nota || 'N/A'}`, {
            citaId: citaCancelacionId,
            motivo: motivo,
            nota: nota
        });

        showToast('Cita cancelada y motivo registrado', 'info');
        cerrarModalCancelacion();
        recargarVistaActual();
    }
}

// Logs Lógica (CLOUDIZÉO)
async function registrarAuditoria(accion, detalle, metadata = {}) {
    try {
        let user = typeof usuarioActual !== 'undefined' ? usuarioActual : null;
        if (!user) {
            const stored = sessionStorage.getItem('usuario');
            if (stored) user = JSON.parse(stored);
        }

        const nombreUsuario = user ? user.nombre : 'Sistema (No Logueado)';
        const rolUsuario = user ? user.rol : 'N/A';

        // Payload optimizado para transporte
        const logPayload = {
            u: nombreUsuario,
            r: rolUsuario,
            a: accion,
            d: detalle,
            ts: Date.now()
        };

        // Generar ID único (Prefijo LOG_)
        // Random incluido para evitar colisiones entre PCs
        const logId = `LOG_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        // Guardar en la "Nube" usando el endpoint de estados existente
        // Aprovechamos que el backend acepta strings arbitrarios como estado
        await setCitaEstado(logId, JSON.stringify(logPayload));

        console.log('Auditoría Cloud registrada:', accion);
    } catch (e) {
        console.error('Error guardando auditoría cloud', e);
    }
}

async function cargarAuditoria() {
    const tbody = document.getElementById('lista-auditoria');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--text-gray);"><span class="sync-indicator" style="display:inline-block; margin-right:5px;"></span>Cargando historial remoto...</td></tr>';

    try {
        // 1. Forzar sincronización para asegurar datos frescos de otras PCs
        await sincronizarEstados();

        // 2. Obtener mapa completo y filtrar logs
        const estados = getCitasEstado();
        const logs = [];

        Object.keys(estados).forEach(key => {
            if (key.toString().startsWith('LOG_')) {
                try {
                    const entry = estados[key];
                    // El contenido real está en la propiedad 'estado' como string JSON
                    // OJO: entry = { estado: "JSON", fecha: "ISO" }
                    // A veces puede venir sucio, validamos
                    if (entry && entry.estado && entry.estado.startsWith('{')) {
                        const content = JSON.parse(entry.estado);
                        logs.push({
                            id: key,
                            fecha: new Date(content.ts || entry.fecha),
                            usuario: content.u || 'Desconocido',
                            rol: content.r || 'N/A',
                            accion: content.a || 'Acción',
                            detalle: content.d || ''
                        });
                    }
                } catch (parseErr) {
                    console.warn('Log corrupto ignorado:', key);
                }
            }
        });

        // 3. Ordenar cronológicamente (Reciente primero)
        logs.sort((a, b) => b.fecha - a.fecha);

        // 4. Renderizar
        tbody.innerHTML = '';

        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--text-gray);">Sin registros de actividad en la nube</td></tr>';
            return;
        }

        logs.forEach(log => {
            const row = document.createElement('tr');
            const fechaStr = log.fecha.toLocaleDateString('es-DO');
            const horaStr = log.fecha.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });

            const badgeClass = log.rol === 'Administrador' ? 'badge-admin' : (log.rol === 'Secretaria' ? 'badge-secretaria' : 'badge-neutral');

            row.innerHTML = `
                <td>${fechaStr}</td>
                <td>${horaStr}</td>
                <td><strong>${log.usuario}</strong></td>
                <td><span class="badge ${badgeClass}">${log.rol}</span></td>
                <td>${log.accion}</td>
                <td style="font-size: 0.9em; color: #555;">${log.detalle}</td>
            `;
            tbody.appendChild(row);
        });

    } catch (e) {
        console.error('Error cargando audit:', e);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: #e74c3c; padding: 20px;">Error de conexión. Intente refrescar.</td></tr>';
    }
}

async function exportarAuditoriaCSV() {
    await sincronizarEstados();
    const estados = getCitasEstado();
    const logs = [];

    // Reutilizar lógica de extracción
    Object.keys(estados).forEach(key => {
        if (key.toString().startsWith('LOG_')) {
            try {
                const entry = estados[key];
                const content = JSON.parse(entry.estado);
                logs.push({
                    fecha: new Date(content.ts || entry.fecha),
                    usuario: content.u,
                    rol: content.r,
                    accion: content.a,
                    detalle: content.d
                });
            } catch (e) { }
        }
    });

    logs.sort((a, b) => b.fecha - a.fecha);

    if (logs.length === 0) {
        showToast('No hay datos en la nube para exportar', 'warning');
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "FechaISO,FechaLocal,Usuario,Rol,Accion,Detalle\n";

    logs.forEach(log => {
        const detalleSafe = (log.detalle || '').replace(/"/g, '""');
        const row = [
            log.fecha.toISOString(),
            `"${log.fecha.toLocaleString('es-DO')}"`,
            `"${log.usuario}"`,
            log.rol,
            `"${log.accion}"`,
            `"${detalleSafe}"`
        ];
        csvContent += row.join(",") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `auditoria_cloud_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ========================================
// SISTEMA DE RESTAURACIÓN (UNDO)
// ========================================
let citaRestaurarId = null;

function iniciarRestauracion(citaId) {
    // Verificar rol
    const esAdmin = usuarioActual && usuarioActual.rol === 'Administrador';

    if (esAdmin) {
        // Admin: Restaurar directo
        ejecutarRestauracion(citaId);
    } else {
        // Secretaria: Requiere clave
        citaRestaurarId = citaId;
        const modal = document.getElementById('modal-password-auth');
        if (modal) {
            modal.style.display = 'flex';
            document.getElementById('auth-password').value = '';
            document.getElementById('auth-password').focus();
        }
    }
}

function cerrarModalPassword() {
    citaRestaurarId = null;
    const modal = document.getElementById('modal-password-auth');
    if (modal) modal.style.display = 'none';
}

function verificarPasswordRestauracion() {
    const pass = document.getElementById('auth-password').value;
    if (pass === 'cristina17') {
        ejecutarRestauracion(citaRestaurarId);
        cerrarModalPassword();
    } else {
        showToast('Contraseña Incorrecta. Acceso Denegado.', 'error');
        document.getElementById('auth-password').value = '';
        document.getElementById('auth-password').focus();
    }
}

async function ejecutarRestauracion(citaId) {
    if (!citaId) return;

    // Restaurar a Pendiente
    await setCitaEstado(citaId, 'pendiente');
    // Registrar Auditoría
    await registrarAuditoria('Restaurar Cita', 'Deshacer cancelación (Restaurada a Pendiente)', {
        citaId: citaId,
        autorizadoPor: usuarioActual ? usuarioActual.rol : 'Admin'
    });

    showToast('Cita restaurada correctamente', 'success');
    recargarVistaActual();
}

// ========================================
// MÓDULO FINANCIERO (Solo Admin)
// ========================================

// Switch Tabs
function switchFinanzaTab(tab) {
    // Reset tabs
    document.querySelectorAll('.fin-tab').forEach(t => {
        t.style.background = '#f0f2f5';
        t.style.color = '#7f8c8d';
        t.style.boxShadow = 'none';
        t.classList.remove('active');
    });

    // Hide forms
    document.getElementById('form-container-ingreso').style.display = 'none';
    document.getElementById('form-container-gasto').style.display = 'none';

    // Activate selected
    const activeTab = document.getElementById(`tab-${tab}`);
    if (tab === 'ingreso') {
        activeTab.style.background = '#27ae60';
        activeTab.style.color = 'white';
        activeTab.style.boxShadow = '0 4px 15px rgba(39, 174, 96, 0.3)';
        document.getElementById('form-container-ingreso').style.display = 'block';
    } else {
        activeTab.style.background = '#e74c3c';
        activeTab.style.color = 'white';
        activeTab.style.boxShadow = '0 4px 15px rgba(231, 76, 60, 0.3)';
        document.getElementById('form-container-gasto').style.display = 'block';
    }
}

// Guardar Ingreso
async function guardarIngreso() {
    const monto = parseFloat(document.getElementById('fin-ingreso-monto').value);
    const concepto = document.getElementById('fin-ingreso-concepto').value.trim();
    const fecha = document.getElementById('fin-ingreso-fecha').value;

    if (!monto || monto <= 0) {
        showToast('Ingrese un monto válido', 'error');
        return;
    }
    if (!concepto) {
        showToast('Ingrese un concepto', 'error');
        return;
    }
    if (!fecha) {
        showToast('Seleccione una fecha', 'error');
        return;
    }

    const payload = {
        tipo: 'ingreso',
        monto: monto,
        concepto: concepto,
        fecha: fecha,
        ts: Date.now(),
        usuario: usuarioActual?.nombre || 'Admin'
    };

    const id = `FIN_ING_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    await setCitaEstado(id, JSON.stringify(payload));

    // Limpiar form
    document.getElementById('fin-ingreso-monto').value = '';
    document.getElementById('fin-ingreso-concepto').value = '';
    document.getElementById('fin-ingreso-fecha').value = '';

    showToast('Ingreso registrado correctamente', 'success');
    cargarFinanzas();
}

// Guardar Gasto
async function guardarGasto() {
    const monto = parseFloat(document.getElementById('fin-gasto-monto').value);
    const categoria = document.getElementById('fin-gasto-categoria').value;
    const nota = document.getElementById('fin-gasto-nota').value.trim();
    const fecha = document.getElementById('fin-gasto-fecha').value;

    if (!monto || monto <= 0) {
        showToast('Ingrese un monto válido', 'error');
        return;
    }
    if (!categoria) {
        showToast('Seleccione una categoría', 'error');
        return;
    }
    if (!fecha) {
        showToast('Seleccione una fecha', 'error');
        return;
    }

    const payload = {
        tipo: 'gasto',
        monto: monto,
        categoria: categoria,
        nota: nota,
        fecha: fecha,
        ts: Date.now(),
        usuario: usuarioActual?.nombre || 'Admin'
    };

    const id = `FIN_GAS_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    await setCitaEstado(id, JSON.stringify(payload));

    // Limpiar form
    document.getElementById('fin-gasto-monto').value = '';
    document.getElementById('fin-gasto-categoria').value = '';
    document.getElementById('fin-gasto-nota').value = '';
    document.getElementById('fin-gasto-fecha').value = '';

    showToast('Gasto registrado correctamente', 'success');
    cargarFinanzas();
}

// Cargar Finanzas
async function cargarFinanzas() {
    const tbody = document.getElementById('lista-finanzas');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">Cargando transacciones...</td></tr>';

    // Sincronizar Cloud
    await sincronizarEstados();
    const estados = getCitasEstado();

    // Extraer transacciones
    let transacciones = [];
    Object.keys(estados).forEach(key => {
        if (key.startsWith('FIN_')) {
            try {
                const entry = estados[key];
                if (entry && entry.estado && entry.estado.startsWith('{')) {
                    const data = JSON.parse(entry.estado);

                    // Skip deleted transactions
                    if (data.deleted === true) {
                        console.log('[FINANZAS] Skipping deleted transaction:', key);
                        return;
                    }

                    transacciones.push({
                        id: key,
                        tipo: data.tipo,
                        monto: data.monto || 0,
                        concepto: data.concepto || data.categoria || '',
                        categoria: data.categoria || '',
                        nota: data.nota || '',
                        fecha: data.fecha,
                        ts: data.ts
                    });
                }
            } catch (e) {
                console.warn('Transacción inválida:', key);
            }
        }
    });

    // Aplicar filtros
    const filtroTipo = document.getElementById('fin-filtro-tipo')?.value || 'todos';
    const filtroMes = document.getElementById('fin-filtro-mes')?.value || '';

    if (filtroTipo !== 'todos') {
        transacciones = transacciones.filter(t => t.tipo === filtroTipo);
    }
    if (filtroMes) {
        transacciones = transacciones.filter(t => t.fecha && t.fecha.startsWith(filtroMes));
    }

    // Ordenar por fecha descendente
    transacciones.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    // Calcular totales
    let totalIngresos = 0;
    let totalGastos = 0;
    transacciones.forEach(t => {
        if (t.tipo === 'ingreso') totalIngresos += t.monto;
        if (t.tipo === 'gasto') totalGastos += t.monto;
    });
    const balance = totalIngresos - totalGastos;

    document.getElementById('fin-total-ingresos').textContent = `RD$ ${formatearNumero(totalIngresos)}`;
    document.getElementById('fin-total-gastos').textContent = `RD$ ${formatearNumero(totalGastos)}`;
    document.getElementById('fin-balance').textContent = `RD$ ${formatearNumero(balance)}`;
    document.getElementById('fin-balance').style.color = balance >= 0 ? '#27ae60' : '#e74c3c';

    // Renderizar tabla
    tbody.innerHTML = '';
    if (transacciones.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: #888;">Sin transacciones registradas</td></tr>';
        return;
    }

    transacciones.forEach(t => {
        const row = document.createElement('tr');
        const tipoColor = t.tipo === 'ingreso' ? '#27ae60' : '#e74c3c';
        const tipoIcon = t.tipo === 'ingreso' ? '💵' : '📉';
        const montoStyle = t.tipo === 'ingreso' ? 'color: #27ae60; font-weight: bold;' : 'color: #e74c3c; font-weight: bold;';

        row.innerHTML = `
            <td>${t.fecha || 'Sin fecha'}</td>
            <td><span style="color: ${tipoColor};">${tipoIcon} ${t.tipo.charAt(0).toUpperCase() + t.tipo.slice(1)}</span></td>
            <td>${t.concepto || t.categoria}</td>
            <td style="font-size: 0.85em; color: #666; max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${t.nota || '-'}</td>
            <td style="${montoStyle}">RD$ ${formatearNumero(t.monto)}</td>
            <td><button class="btn-sm btn-danger btn-eliminar-transaccion" data-id="${t.id}" title="Eliminar">🗑️</button></td>
        `;
        tbody.appendChild(row);
    });

    // Renderizar Resumen Mensual (usa todas las transacciones, sin filtro de tipo/mes)
    renderizarResumenMensual(estados);
}

// Renderizar Resumen Mensual
function renderizarResumenMensual(estados) {
    const tbodyMensual = document.getElementById('lista-resumen-mensual');
    if (!tbodyMensual) return;

    // Recopilar TODAS las transacciones (sin filtros)
    const porMes = {};
    const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    Object.keys(estados).forEach(key => {
        if (key.startsWith('FIN_')) {
            try {
                const entry = estados[key];
                if (entry && entry.estado && entry.estado.startsWith('{')) {
                    const data = JSON.parse(entry.estado);
                    if (data.deleted) return;
                    if (!data.fecha) return;

                    // Extraer año-mes (YYYY-MM)
                    const mesKey = data.fecha.substring(0, 7);
                    if (!porMes[mesKey]) {
                        porMes[mesKey] = { ingresos: 0, gastos: 0 };
                    }
                    if (data.tipo === 'ingreso') {
                        porMes[mesKey].ingresos += data.monto || 0;
                    } else if (data.tipo === 'gasto') {
                        porMes[mesKey].gastos += data.monto || 0;
                    }
                }
            } catch (e) { }
        }
    });

    // Convertir a lista y ordenar descendente
    const mesesArr = Object.keys(porMes).sort((a, b) => b.localeCompare(a));

    tbodyMensual.innerHTML = '';
    if (mesesArr.length === 0) {
        tbodyMensual.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 15px; color: #888;">Sin datos mensuales</td></tr>';
        // Hide dashboard if no data
        if (document.getElementById('fin-dashboard')) {
            document.getElementById('fin-dashboard').style.display = 'none';
        }
        return;
    }

    // Initialize KPI Totals
    let totalIngresoGlobal = 0;
    let totalGastoGlobal = 0;

    mesesArr.forEach(mesKey => {
        const datos = porMes[mesKey];
        const balance = datos.ingresos - datos.gastos;
        const esNegativo = balance < 0;

        // Formatear mes para display (2024-11 -> Noviembre 2024)
        const [year, month] = mesKey.split('-');
        const mesNombre = mesesNombres[parseInt(month) - 1] || month;
        const mesDisplay = `${mesNombre} ${year}`;

        // Populate Table
        const row = document.createElement('tr');
        if (esNegativo) row.classList.add('row-negative');

        row.innerHTML = `
            <td style="font-weight: 600;">${mesDisplay}</td>
            <td style="color: #27ae60; font-family: monospace; font-size: 1.05em;">RD$ ${formatearNumero(datos.ingresos)}</td>
            <td style="color: #e74c3c; font-family: monospace; font-size: 1.05em;">RD$ ${formatearNumero(datos.gastos)}</td>
            <td style="font-weight: 700; color: ${esNegativo ? '#c53030' : '#27ae60'}; font-family: monospace; font-size: 1.1em;">RD$ ${formatearNumero(balance)}</td>
            <td>
                ${esNegativo
                ? '<span class="badge-status badge-danger">⚠️ NEGATIVO</span>'
                : '<span class="badge-status badge-success">✅ POSITIVO</span>'
            }
            </td>
        `;
        tbodyMensual.appendChild(row);

        // Calculate Totals for KPI Cards
        totalIngresoGlobal += datos.ingresos;
        totalGastoGlobal += datos.gastos;
    });

    // Update KPI Cards
    const kpiIngreso = document.getElementById('kpi-total-ingreso');
    const kpiGasto = document.getElementById('kpi-total-gasto');
    const kpiBalance = document.getElementById('kpi-total-balance');

    if (kpiIngreso) kpiIngreso.innerText = `RD$ ${formatearNumero(totalIngresoGlobal)}`;
    if (kpiGasto) kpiGasto.innerText = `RD$ ${formatearNumero(totalGastoGlobal)}`;
    if (kpiBalance) {
        const totalBalance = totalIngresoGlobal - totalGastoGlobal;
        kpiBalance.innerText = `RD$ ${formatearNumero(totalBalance)}`;
    }

    // Render Chart
    renderFinanzaChart(porMes);
}

let financeChartInstance = null;

function renderFinanzaChart(resumenMensual) {
    const ctx = document.getElementById('finanzaChart')?.getContext('2d');
    if (!ctx) return;

    // Sort keys to ensure chronological order for chart
    const sortedKeys = Object.keys(resumenMensual).sort((a, b) => a.localeCompare(b));

    // Arrays for Chart Data
    const labels = sortedKeys.map(key => {
        const [year, month] = key.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1); // 0-indexed month
        return date.toLocaleString('es-ES', { month: 'short', year: 'numeric' });
    });

    const dataIngresos = sortedKeys.map(key => resumenMensual[key].ingresos);
    const dataGastos = sortedKeys.map(key => resumenMensual[key].gastos);

    if (financeChartInstance) {
        financeChartInstance.destroy(); // Clear previous chart
    }

    financeChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Ingresos',
                    data: dataIngresos,
                    backgroundColor: 'rgba(46, 204, 113, 0.6)',
                    borderColor: 'rgba(39, 174, 96, 1)',
                    borderWidth: 2,
                    borderRadius: 8,
                    barPercentage: 0.6
                },
                {
                    label: 'Gastos',
                    data: dataGastos,
                    backgroundColor: 'rgba(231, 76, 60, 0.6)',
                    borderColor: 'rgba(192, 57, 43, 1)',
                    borderWidth: 2,
                    borderRadius: 8,
                    barPercentage: 0.6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        font: { family: "'Inter', sans-serif", size: 14 },
                        usePointStyle: true
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(44, 62, 80, 0.9)',
                    padding: 12,
                    titleFont: { size: 14, weight: 'bold' },
                    bodyFont: { size: 13 },
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)',
                        borderDash: [5, 5]
                    },
                    ticks: {
                        font: { family: "'Inter', sans-serif" },
                        callback: function (value) {
                            return 'RD$ ' + value.toLocaleString(); // Shorten format axis
                        }
                    }
                },
                x: {
                    grid: { display: false }
                }
            },
            animation: {
                duration: 1500,
                easing: 'easeOutQuart'
            }
        }
    });
}

// Eliminar Transacción - Using Modal
let transaccionAEliminar = null;

function eliminarTransaccion(id) {
    console.log('[DELETE] Iniciando eliminación de:', id);
    transaccionAEliminar = id;

    // Configurar el modal
    const modal = document.getElementById('confirm-modal');
    const title = document.getElementById('confirm-modal-title');
    const message = document.getElementById('confirm-modal-message');
    const btnCancel = document.getElementById('confirm-modal-cancel');
    const btnOk = document.getElementById('confirm-modal-ok');

    if (!modal) {
        console.error('[DELETE] Modal no encontrado');
        alert('Error: Modal no disponible');
        return;
    }

    title.textContent = '🗑️ Eliminar Transacción';
    message.textContent = '¿Está seguro de que desea eliminar esta transacción? Esta acción no se puede deshacer.';
    btnOk.textContent = 'Sí, Eliminar';
    btnOk.className = 'btn-danger';

    // Mostrar modal
    modal.style.display = 'flex';

    // Configurar botones
    btnCancel.onclick = function () {
        modal.style.display = 'none';
        transaccionAEliminar = null;
    };

    btnOk.onclick = function () {
        modal.style.display = 'none';
        ejecutarEliminacionTransaccion();
    };
}

function ejecutarEliminacionTransaccion() {
    const id = transaccionAEliminar;
    console.log('[DELETE] Ejecutando eliminación de:', id);

    if (!id) {
        console.error('[DELETE] No hay ID de transacción');
        return;
    }

    try {
        // Obtener estados actuales
        const estadosStr = localStorage.getItem('citasEstado') || '{}';
        const estados = JSON.parse(estadosStr);

        // Marcar como eliminado
        estados[id] = {
            estado: JSON.stringify({ deleted: true }),
            fecha: new Date().toISOString()
        };

        // Guardar
        localStorage.setItem('citasEstado', JSON.stringify(estados));

        console.log('[DELETE] Transacción eliminada:', id);
        showToast('Transacción eliminada correctamente', 'success');

        // Limpiar
        transaccionAEliminar = null;

        // Recargar tabla
        cargarFinanzas();

    } catch (error) {
        console.error('[DELETE] Error:', error);
        showToast('Error al eliminar', 'error');
    }
}

// Limpiar Filtros
function limpiarFiltrosFinanzas() {
    document.getElementById('fin-filtro-tipo').value = 'todos';
    document.getElementById('fin-filtro-mes').value = '';
    cargarFinanzas();
}

// Exportar CSV
async function exportarFinanzasCSV() {
    await sincronizarEstados();
    const estados = getCitasEstado();
    const transacciones = [];

    Object.keys(estados).forEach(key => {
        if (key.startsWith('FIN_')) {
            try {
                const entry = estados[key];
                const data = JSON.parse(entry.estado);
                if (data.deleted) return;
                transacciones.push({
                    fecha: data.fecha,
                    tipo: data.tipo,
                    concepto: data.concepto || data.categoria,
                    nota: data.nota || '',
                    monto: data.monto
                });
            } catch (e) { }
        }
    });

    if (transacciones.length === 0) {
        showToast('No hay datos para exportar', 'warning');
        return;
    }

    let csv = "data:text/csv;charset=utf-8,";
    csv += "Fecha,Tipo,Concepto,Nota,Monto\n";
    transacciones.forEach(t => {
        const notaSafe = (t.nota || '').replace(/"/g, '""');
        csv += `${t.fecha},${t.tipo},"${t.concepto}","${notaSafe}",${t.monto}\n`;
    });

    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `finanzas_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Exponer funciones globalmente
window.guardarIngreso = guardarIngreso;
window.guardarGasto = guardarGasto;
window.cargarFinanzas = cargarFinanzas;
window.eliminarTransaccion = eliminarTransaccion;
window.limpiarFiltrosFinanzas = limpiarFiltrosFinanzas;
window.exportarFinanzasCSV = exportarFinanzasCSV;

// Event Delegation para botones de eliminar transacción
document.addEventListener('click', function (e) {
    const btn = e.target.closest('.btn-eliminar-transaccion');
    if (btn) {
        e.preventDefault();
        e.stopPropagation();
        const transaccionId = btn.getAttribute('data-id');
        if (transaccionId) {
            eliminarTransaccion(transaccionId);
        }
    }
});
