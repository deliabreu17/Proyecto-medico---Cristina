// ============================================
// ⚙️ CONFIGURACIÓN GENERAL
// ============================================
const SHEET_ESTADOS = 'Estados_Actuales'; 
const SHEET_HISTORIAL = 'Historial_Estados'; 
const SHEET_RESPUESTAS = 'Respuestas de formulario 1'; 
const ZONA_HORARIA = "America/Santo_Domingo";

const CONFIG_CUPOS = {
  MAX_CUPOS_REGULARES: 10,  // Primeros 10 reciben correo regular (Llegada 4:30 PM)
  MAX_CUPOS_TOTALES: 12,    // Puestos 11 y 12 reciben sobrecupo (Llegada 5:30 PM), luego se bloquea la fecha
  PREGUNTA_FECHA: '¿Para qué fecha deseas la cita?' // Pregunta de fecha en el Formulario
};

// ============================================
// 📖 MÉTODO GET: LEER ESTADOS ACTUALES (API WEB)
// ============================================
function doGet(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ESTADOS);
    
    if (!sheet) {
      return crearRespuesta({});
    }
    
    var data = sheet.getDataRange().getValues();
    var estados = {};
    
    for (var i = 1; i < data.length; i++) {
      if (data[i][0]) { 
        estados[data[i][0]] = {
          estado: data[i][1],
          fechaCambio: data[i][2],
          usuario: data[i][3]
        };
      }
    }
    
    return crearRespuesta(estados);
      
  } catch (error) {
    Logger.log("Error en doGet: " + error.toString());
    return crearRespuesta({ error: error.toString() });
  }
}

// ============================================
// 📝 MÉTODO POST: GUARDAR Y REGISTRAR ESTADOS (API WEB)
// ============================================
function doPost(e) {
  var lock = LockService.getScriptLock();
  
  try {
    lock.waitLock(10000); 
    
    var params = JSON.parse(e.postData.contents);
    var citaId = params.citaId;
    var estado = params.estado;
    var usuario = params.usuario || 'Sistema Web';
    var fechaActual = Utilities.formatDate(new Date(), ZONA_HORARIA, "dd/MM/yyyy hh:mm a"); 
    
    if (!citaId || !estado) {
       return crearRespuesta({ error: "Faltan parámetros obligatorios (citaId o estado)." });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1️⃣ GESTIÓN DE LA HOJA PRINCIPAL (Estado Actual)
    var sheetEstados = ss.getSheetByName(SHEET_ESTADOS);
    if (!sheetEstados) {
      sheetEstados = ss.insertSheet(SHEET_ESTADOS);
      sheetEstados.appendRow(['ID Cita', 'Estado Actual', 'Última Actualización', 'Usuario Modificador']);
      sheetEstados.getRange("A1:D1").setFontWeight("bold");
      sheetEstados.setFrozenRows(1);
    }
    
    var dataEstados = sheetEstados.getDataRange().getValues();
    var rowIndex = -1;
    
    for (var i = 1; i < dataEstados.length; i++) {
      if (dataEstados[i][0] === citaId) {
        rowIndex = i + 1; 
        break;
      }
    }
    
    var filaDatos = [citaId, estado, fechaActual, usuario];
    
    if (rowIndex > 0) {
      sheetEstados.getRange(rowIndex, 1, 1, 4).setValues([filaDatos]);
    } else {
      sheetEstados.appendRow(filaDatos);
    }

    // 2️⃣ GESTIÓN DE LA HOJA HISTÓRICA (Bitácora inmutable)
    var sheetHistorial = ss.getSheetByName(SHEET_HISTORIAL);
    if (!sheetHistorial) {
      sheetHistorial = ss.insertSheet(SHEET_HISTORIAL);
      sheetHistorial.appendRow(['Fecha y Hora', 'ID Cita', 'Estado Asignado', 'Usuario Modificador']);
      sheetHistorial.getRange("A1:D1").setFontWeight("bold");
      sheetHistorial.setFrozenRows(1);
    }

    sheetHistorial.appendRow([fechaActual, citaId, estado, usuario]);
    
    return crearRespuesta({ 
      success: true, 
      mensaje: "Estado actualizado y registrado en bitácora",
      citaId: citaId, 
      estado: estado, 
      actualizacion: fechaActual 
    });
      
  } catch (error) {
    Logger.log("Error en doPost: " + error.toString());
    return crearRespuesta({ success: false, error: error.toString() });
  } finally {
    lock.releaseLock(); 
  }
}

// ============================================
// 🛠️ FUNCIÓN AUXILIAR: ESTANDARIZAR RESPUESTAS
// ============================================
function crearRespuesta(datos) {
  var output = ContentService.createTextOutput(JSON.stringify(datos));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

// =========================================================================
// 📧 GESTIÓN DE FORMULARIO: CUPOS (10/12), CORREOS Y BLOQUEO AUTOMÁTICO
// =========================================================================

/**
 * Función disparada automáticamente al enviarse el formulario
 */
function alEnviarFormulario(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_RESPUESTAS) || ss.getActiveSheet();
    var lastRow = sheet.getLastRow();
    
    if (lastRow < 2) return;
    
    var filaNueva = sheet.getRange(lastRow, 1, 1, sheet.getLastColumn()).getValues()[0];
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    var idxFecha = headers.findIndex(function(h) { return h.toString().toLowerCase().includes('fecha'); });
    var idxPaciente = headers.findIndex(function(h) { return h.toString().toLowerCase().includes('nombre') && h.toString().toLowerCase().includes('paciente'); });
    var idxEmail = headers.findIndex(function(h) { return h.toString().toLowerCase().includes('correo') || h.toString().toLowerCase().includes('email'); });
    var idxMotivo = headers.findIndex(function(h) { return h.toString().toLowerCase().includes('motivo'); });
    
    var fechaCita = (idxFecha !== -1 ? filaNueva[idxFecha] : filaNueva[2]).toString().trim();
    var nombrePaciente = (idxPaciente !== -1 ? filaNueva[idxPaciente] : filaNueva[3]).toString().trim();
    var emailDestino = (idxEmail !== -1 ? filaNueva[idxEmail] : filaNueva[filaNueva.length - 1]).toString().trim();
    var motivo = (idxMotivo !== -1 ? filaNueva[idxMotivo] : 'Consulta médica').toString().trim();
    
    if (!fechaCita || !emailDestino) {
      Logger.log('Fila con datos incompletos: ' + lastRow);
      return;
    }
    
    // Contar cuántas citas van registradas para esta fecha
    var todasLasFilas = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    var totalCitasFecha = 0;
    
    todasLasFilas.forEach(function(fila) {
      var f = (idxFecha !== -1 ? fila[idxFecha] : fila[2]).toString().trim();
      if (f === fechaCita) {
        totalCitasFecha++;
      }
    });
    
    Logger.log("Paciente: " + nombrePaciente + " | Fecha: " + fechaCita + " | Turno #" + totalCitasFecha);
    
    var ticketId = generarTicketId();
    
    // 1️⃣ Envío de correo según el cupo
    if (totalCitasFecha <= CONFIG_CUPOS.MAX_CUPOS_REGULARES) {
      enviarCorreoRegular(emailDestino, nombrePaciente, fechaCita, ticketId, motivo, totalCitasFecha);
    } else if (totalCitasFecha <= CONFIG_CUPOS.MAX_CUPOS_TOTALES) {
      enviarCorreoSobrecupo(emailDestino, nombrePaciente, fechaCita, ticketId, motivo, totalCitasFecha);
    } else {
      enviarCorreoLimiteExcedido(emailDestino, nombrePaciente, fechaCita);
    }
    
    // 2️⃣ Bloqueo automático del día al alcanzar 12 cupos
    if (totalCitasFecha >= CONFIG_CUPOS.MAX_CUPOS_TOTALES) {
      bloquearFechaEnFormulario(fechaCita);
    }
    
  } catch (error) {
    Logger.log('Error en alEnviarFormulario: ' + error.toString());
  }
}

function generarTicketId() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var ticket = '';
  for (var i = 0; i < 6; i++) {
    ticket += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return ticket;
}

function enviarCorreoRegular(email, nombre, fecha, ticketId, motivo, posicion) {
  var asunto = 'Ticket de Cita #' + ticketId + ' - Consultorio Dra. Cristina García';
  
  var htmlBody = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<style>' +
    'body { font-family: Arial, sans-serif; background-color: #121824; margin: 0; padding: 20px; color: #f8fafc; }' +
    '.container { max-width: 520px; margin: 0 auto; background-color: #1a2234; border-radius: 16px; border: 1px solid #2d3748; overflow: hidden; }' +
    '.header { text-align: center; padding: 30px 20px 10px; }' +
    '.subtitle { font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: #94a3b8; margin-bottom: 8px; }' +
    '.title { font-size: 26px; font-weight: 800; color: #60a5fa; margin: 0; }' +
    '.content { padding: 20px 30px; }' +
    '.greeting { font-size: 16px; line-height: 1.6; color: #cbd5e1; margin-bottom: 25px; }' +
    '.card-info { background-color: #111827; border-left: 4px solid #3b82f6; border-radius: 10px; padding: 20px; margin-bottom: 25px; }' +
    '.card-row { margin-bottom: 10px; font-size: 15px; }' +
    '.ticket-box { display: flex; justify-content: space-between; align-items: center; background-color: #0f172a; border-radius: 10px; padding: 15px 20px; margin-bottom: 25px; }' +
    '.ticket-id { font-size: 22px; font-weight: 800; letter-spacing: 2px; color: #f1f5f9; }' +
    '.instructions { font-size: 14px; line-height: 1.6; color: #94a3b8; background-color: #1e293b; padding: 15px; border-radius: 8px; }' +
    '.footer { text-align: center; padding: 20px; font-size: 12px; color: #64748b; border-top: 1px solid #2d3748; }' +
    '</style></head><body>' +
    '<div class="container">' +
      '<div class="header">' +
        '<div class="subtitle">CONSULTORIO MÉDICO - DRA. CRISTINA GARCÍA</div>' +
        '<div class="title">TICKET DE CITA</div>' +
      '</div>' +
      '<div class="content">' +
        '<div class="greeting">Hola <strong>' + nombre + '</strong>,<br>Nos alegra confirmarte que tu solicitud de cita ha sido procesada con éxito.</div>' +
        '<div class="card-info">' +
          '<div class="card-row">📅 <strong>Fecha asignada:</strong> ' + fecha + '</div>' +
          '<div class="card-row">⏰ <strong>Hora de llegada:</strong> A partir de las 4:30 PM</div>' +
          '<div class="card-row">🩺 <strong>Motivo:</strong> ' + motivo + '</div>' +
        '</div>' +
        '<div class="ticket-box">' +
          '<div><div style="font-size: 11px; color: #94a3b8;">TICKET ID</div><div class="ticket-id">' + ticketId + '</div></div>' +
          '<div style="background-color: #2563eb; color: white; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: bold;">Turno #' + posicion + '</div>' +
        '</div>' +
        '<div class="instructions">' +
          '<strong>📌 Instrucciones importantes:</strong>' +
          '<ul style="margin: 8px 0 0 0; padding-left: 20px;">' +
            '<li>Debe llegar a partir de las <strong>4:30 PM</strong>, ya que se atenderá por <strong>estricto orden de llegada</strong>.</li>' +
            '<li>Presentar documento de identidad y carnet de seguro (si aplica) en recepción.</li>' +
          '</ul>' +
        '</div>' +
      '</div>' +
      '<div class="footer">Dra. Cristina García Domínguez • Pediatra Cardióloga</div>' +
    '</div></body></html>';
  
  GmailApp.sendEmail(email, asunto, 'Tu cita para el ' + fecha + ' está confirmada. Ticket: ' + ticketId + '. Llegar a partir de las 4:30 PM.', {
    htmlBody: htmlBody,
    name: 'Dra. Cristina García'
  });
}

function enviarCorreoSobrecupo(email, nombre, fecha, ticketId, motivo, posicion) {
  var asunto = '⚠️ Turno Adicional / Sobrecupo #' + ticketId + ' - Dra. Cristina García';
  
  var htmlBody = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<style>' +
    'body { font-family: Arial, sans-serif; background-color: #121824; margin: 0; padding: 20px; color: #f8fafc; }' +
    '.container { max-width: 520px; margin: 0 auto; background-color: #1a2234; border-radius: 16px; border: 1px solid #f59e0b; overflow: hidden; }' +
    '.header { text-align: center; padding: 30px 20px 10px; background: rgba(245, 158, 11, 0.15); }' +
    '.subtitle { font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: #f59e0b; font-weight: bold; }' +
    '.title { font-size: 24px; font-weight: 800; color: #fbbf24; margin: 0; }' +
    '.content { padding: 20px 30px; }' +
    '.greeting { font-size: 16px; line-height: 1.6; color: #cbd5e1; margin-bottom: 20px; }' +
    '.card-info { background-color: #111827; border-left: 4px solid #f59e0b; border-radius: 10px; padding: 20px; margin-bottom: 25px; }' +
    '.card-row { margin-bottom: 10px; font-size: 15px; }' +
    '.ticket-box { display: flex; justify-content: space-between; align-items: center; background-color: #0f172a; border-radius: 10px; padding: 15px 20px; margin-bottom: 25px; }' +
    '.ticket-id { font-size: 22px; font-weight: 800; letter-spacing: 2px; color: #fbbf24; }' +
    '.instructions { font-size: 14px; line-height: 1.6; color: #e2e8f0; background-color: #78350f; padding: 18px; border-radius: 8px; border-left: 4px solid #f59e0b; }' +
    '.footer { text-align: center; padding: 20px; font-size: 12px; color: #64748b; border-top: 1px solid #2d3748; }' +
    '</style></head><body>' +
    '<div class="container">' +
      '<div class="header">' +
        '<div class="subtitle">CONSULTORIO MÉDICO - DRA. CRISTINA GARCÍA</div>' +
        '<div class="title">TICKET DE CITA - SOBRECUPO</div>' +
        '<div style="background-color: #d97706; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; display: inline-block; margin-top: 8px;">TURNO ADICIONAL #' + posicion + ' DE 12</div>' +
      '</div>' +
      '<div class="content">' +
        '<div class="greeting">Hola <strong>' + nombre + '</strong>,<br>Tu solicitud ha sido recibida y asignada como <strong>Turno Adicional / Sobrecupo</strong> debido a alta demanda.</div>' +
        '<div class="card-info">' +
          '<div class="card-row">📅 <strong>Fecha asignada:</strong> ' + fecha + '</div>' +
          '<div class="card-row">⏰ <strong>Horario:</strong> Turno Adicional (al finalizar turnos regulares)</div>' +
          '<div class="card-row">🩺 <strong>Motivo:</strong> ' + motivo + '</div>' +
        '</div>' +
        '<div class="ticket-box">' +
          '<div><div style="font-size: 11px; color: #f59e0b;">TICKET SOBRECUPO</div><div class="ticket-id">' + ticketId + '</div></div>' +
          '<div style="background-color: #d97706; color: white; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: bold;">Sobrecupo #' + posicion + '</div>' +
        '</div>' +
        '<div class="instructions">' +
          '<strong>⚠️ AVISO IMPORTANTE DE ATENCIÓN:</strong>' +
          '<ul style="margin: 8px 0 0 0; padding-left: 20px;">' +
            '<li>Su cita es un <strong>turno adicional extraordinario</strong>. Será atendido(a) una vez concluyan los 10 pacientes regulares de la tanda.</li>' +
            '<li>Por favor presentarse a partir de las <strong>5:30 PM</strong> y confirmar su llegada con la secretaria.</li>' +
            '<li>Agradecemos su paciencia y comprensión para brindarle la mejor atención médica.</li>' +
          '</ul>' +
        '</div>' +
      '</div>' +
      '<div class="footer">Dra. Cristina García Domínguez • Pediatra Cardióloga</div>' +
    '</div></body></html>';
  
  GmailApp.sendEmail(email, asunto, 'Tu cita para el ' + fecha + ' ha sido asignada como Turno Adicional (Sobrecupo #' + posicion + '). Ticket: ' + ticketId + '.', {
    htmlBody: htmlBody,
    name: 'Dra. Cristina García'
  });
}

function enviarCorreoLimiteExcedido(email, nombre, fecha) {
  var asunto = 'Aviso sobre tu solicitud de cita - Dra. Cristina García';
  var mensaje = 'Hola ' + nombre + ',\n\nTe informamos que la fecha ' + fecha + ' ya ha alcanzado el límite máximo de pacientes permitidos por el consultorio.\n\nPor favor contáctanos directamente o selecciona una nueva fecha disponible.\n\nAtentamente,\nConsultorio Dra. Cristina García Domínguez';
  
  GmailApp.sendEmail(email, asunto, mensaje, { name: 'Dra. Cristina García' });
}

function bloquearFechaEnFormulario(fechaABloquear) {
  try {
    var formUrl = SpreadsheetApp.getActiveSpreadsheet().getFormUrl();
    if (!formUrl) {
      Logger.log('No se encontró URL del formulario vinculado.');
      return;
    }
    
    var form = FormApp.openByUrl(formUrl);
    var items = form.getItems();
    
    items.forEach(function(item) {
      if (item.getTitle().trim() === CONFIG_CUPOS.PREGUNTA_FECHA.trim() || item.getTitle().toLowerCase().includes('fecha')) {
        if (item.getType() === FormApp.ItemType.LIST) {
          var listItem = item.asListItem();
          var choices = listItem.getChoices();
          var newChoices = choices.filter(function(c) { return c.getValue().trim() !== fechaABloquear.trim(); });
          listItem.setChoices(newChoices);
          Logger.log('Fecha "' + fechaABloquear + '" removida de lista desplegable.');
        } else if (item.getType() === FormApp.ItemType.MULTIPLE_CHOICE) {
          var mcItem = item.asMultipleChoiceItem();
          var choices = mcItem.getChoices();
          var newChoices = choices.filter(function(c) { return c.getValue().trim() !== fechaABloquear.trim(); });
          mcItem.setChoices(newChoices);
          Logger.log('Fecha "' + fechaABloquear + '" removida de opciones múltiples.');
        }
      }
    });
  } catch (error) {
    Logger.log('Error al bloquear fecha en formulario: ' + error.toString());
  }
}

function sincronizarYBloquearFechasLlenas() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RESPUESTAS) || SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idxFecha = headers.findIndex(function(h) { return h.toString().toLowerCase().includes('fecha'); });
  var todasLasFilas = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  
  var conteoFechas = {};
  todasLasFilas.forEach(function(fila) {
    var f = (idxFecha !== -1 ? fila[idxFecha] : fila[2]).toString().trim();
    if (f) {
      conteoFechas[f] = (conteoFechas[f] || 0) + 1;
    }
  });
  
  Logger.log('=== VERIFICANDO FECHAS LLENAS ===');
  Object.keys(conteoFechas).forEach(function(fecha) {
    if (conteoFechas[fecha] >= CONFIG_CUPOS.MAX_CUPOS_TOTALES) {
      Logger.log('Bloqueando fecha llena: ' + fecha + ' (' + conteoFechas[fecha] + ' citas)');
      bloquearFechaEnFormulario(fecha);
    }
  });
}
