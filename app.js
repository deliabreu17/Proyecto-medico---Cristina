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

    // Encontrar índices de columnas con búsqueda más flexible
    const colIndices = {
        nombre: headers.findIndex(h => h.includes('nombre') && (h.includes('paciente') || h.includes('completo'))),
        fecha: headers.findIndex(h => h.includes('fecha')),
        telefono: headers.findIndex(h => h.includes('tel')),
        motivo: headers.findIndex(h => h.includes('motivo') && h.includes('principal')),
        especialidad: headers.findIndex(h => h.includes('especialidad')),
        seguro: headers.findIndex(h => h.includes('seguro') && h.includes('privada')),
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
        const tipoSeguro = (valores[colIndices.seguro] || '').trim();
        const timestampStr = (colIndices.timestamp !== -1) ? (valores[colIndices.timestamp] || '') : '';

        // Parsear fecha de creación para ordenamiento
        let fechaCreacion = new Date(0); // Fallback
        if (timestampStr) {
            // Intento básico de parseo dd/mm/yyyy hh:mm:ss
            try {
                const parts = timestampStr.split(' ');
                const dateParts = parts[0].split('/');
                if (dateParts.length === 3) {
                    // Asume dd/mm/yyyy. Si falla, el Date será Invalid
                    const timePart = parts.length > 1 ? parts[1] : '00:00:00';
                    const isoStr = `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}T${timePart}`;
                    const d = new Date(isoStr);
                    if (!isNaN(d.getTime())) fechaCreacion = d;
                }
            } catch (e) { console.warn('Error parseando timestamp', timestampStr); }
        }

        if (nombre) {
            const tipoSeguroNormalizado = normalizarSeguroSimple(tipoSeguro);
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

function normalizarSeguroSimple(valor) {
    if (!valor) return 'No especificado';
    const lower = valor.toLowerCase();
    if (lower.includes('seguro')) return 'Seguro Médico';
    if (lower.includes('privad')) return 'Privada';
    return valor;
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
        <div class="modal-item">
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
    actualizarFechaDisplay();

    if (todasLasCitas.length === 0) {
        todasLasCitas = await cargarDatosDeGoogle();
    }

    const fechaStr = formatearFechaLocal(fechaSeleccionada);

    // Filtrar citas de Google Sheets que NO estén reagendadas
    let citasFecha = todasLasCitas.filter(c => {
        const citaId = generarCitaId(c);
        const estado = getCitaEstado(citaId);
        // Incluir si coincide la fecha Y no está reagendada
        return c.fecha === fechaStr && estado !== 'reagendada';
    });

    // Agregar citas reagendadas a esta fecha
    const citasReagendadas = getCitasReagendadas();
    citasReagendadas.forEach(citaReag => {
        if (citaReag.fecha === fechaStr) {
            citasFecha.push(citaReag);
        }
    });

    // Deduplicar citas: mismo teléfono + misma fecha = una sola cita
    citasFecha = deduplicarCitas(citasFecha);

    document.getElementById('citas-count').textContent = `${citasFecha.length} cita${citasFecha.length !== 1 ? 's' : ''}`;
    mostrarCitas(citasFecha, 'citas-agenda-lista');
}

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
        <div class="paciente-card">
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
        const telefonoNorm = normalizarTelefono(cita.telefono);

        // Botones de acción (solo si no está cancelada o completada)
        let botonesHTML = '';
        if (estado !== 'cancelada' && estado !== 'reagendada' && estado !== 'completada') {
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
                <div class="cita-avatar" onclick="mostrarHistorialPaciente('${telefonoNorm}')" style="cursor:pointer" title="Ver historial">${getInitials(cita.paciente)}</div>
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
function confirmarCita(citaId) {
    setCitaEstado(citaId, 'confirmada');
    showToast('Cita confirmada correctamente', 'success');
    // Recargar vista actual
    if (document.getElementById('view-citas').classList.contains('active')) {
        cargarAgenda();
    } else {
        cargarDashboard();
    }
}

async function cancelarCita(citaId) {
    const confirmado = await showConfirm('¿Está seguro de cancelar esta cita?', 'Cancelar Cita');
    if (confirmado) {
        setCitaEstado(citaId, 'cancelada');
        showToast('Cita cancelada', 'warning');
        if (document.getElementById('view-citas').classList.contains('active')) {
            cargarAgenda();
        } else {
            cargarDashboard();
        }
    }
}

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

    // Renderizar gráficos interactivos (TODOS son clickeables ahora)
    renderizarBarrasInteractivas('chart-especialidades', especialidades, 'teal', 'especialidad');
    renderizarBarrasInteractivas('chart-seguro', seguros, 'coral', 'tipoSeguro');
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
            <div class="search-result-item" onclick="mostrarHistorialPaciente('${normalizarTelefono(p.telefono)}')">
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

// ========================================
// Historial de Paciente
// ========================================
function mostrarHistorialPaciente(telefonoNorm) {
    // Buscar todas las citas de este paciente
    const citasPaciente = todasLasCitas.filter(c =>
        normalizarTelefono(c.telefono) === telefonoNorm
    );

    if (citasPaciente.length === 0) {
        showToast('No se encontró historial para este paciente', 'warning');
        return;
    }

    // Obtener nombre del paciente (el más largo)
    const nombrePaciente = citasPaciente.reduce((longest, c) =>
        c.paciente.length > longest.length ? c.paciente : longest
        , '');

    // Ordenar por fecha (más reciente primero)
    citasPaciente.sort((a, b) => {
        if (!a.fecha || !b.fecha) return 0;
        return b.fecha.localeCompare(a.fecha);
    });

    // Crear modal
    let modal = document.getElementById('modal-historial');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-historial';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="modal-content history-modal-content">
            <div class="modal-header">
                <h3>📋 Historial de ${nombrePaciente}</h3>
                <button class="modal-close" onclick="cerrarModalHistorial()">×</button>
            </div>
            <div class="modal-body">
                <p style="margin-bottom: 16px; color: var(--text-gray);">
                    📞 ${citasPaciente[0].telefono} • ${citasPaciente.length} cita${citasPaciente.length !== 1 ? 's' : ''} registrada${citasPaciente.length !== 1 ? 's' : ''}
                </p>
                <div class="history-list">
                    ${citasPaciente.map(c => {
        const citaId = generarCitaId(c);
        const estado = getCitaEstado(citaId);
        const notas = getCitaNotas(citaId);
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
    // Copia para no alterar el orden original
    let citasOrdenadas = [...todasLasCitas];

    // Preferir ordenamiento por Timestamp de creación si existe
    const tieneTimestamps = citasOrdenadas.some(c => c.creadoEn && c.creadoEn.getTime() > 0);

    if (tieneTimestamps) {
        citasOrdenadas.sort((a, b) => b.creadoEn - a.creadoEn);
    } else {
        // Fallback: Asumir que las últimas del CSV son las más nuevas
        citasOrdenadas.reverse();
    }

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

        const highlightStyle = esNueva ? 'background-color: rgba(72, 201, 176, 0.1); border-left: 3px solid var(--teal);' : 'border-left: 3px solid transparent;';

        return `
            <div class="notification-item" style="padding: 12px; margin-bottom: 8px; border-bottom: 1px solid var(--border); border-radius: 4px; ${highlightStyle}">
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

