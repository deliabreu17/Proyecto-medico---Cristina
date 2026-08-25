/**
 * =========================================================================
 * SISTEMA MÉDICO - DRA. CRISTINA GARCÍA DOMÍNGUEZ
 * Google Apps Script: Gestión de Cupos (10 / 12), Correos y Bloqueo de Formulario
 * =========================================================================
 * 
 * INSTRUCCIONES DE INSTALACIÓN:
 * 1. Abre la hoja de cálculo de Google Sheets vinculada al formulario.
 * 2. Ve al menú superior: Extensiones -> Apps Script.
 * 3. Reemplaza el código existente o pega este código en un archivo llamado "Codigo.gs".
 * 4. Guarda el proyecto (icono de disco).
 * 5. Ve al menú lateral izquierdo de Apps Script -> "Activadores" (icono de reloj ⏰).
 * 6. Haz clic en "Añadir activador":
 *    - Función que se debe ejecutar: "alEnviarFormulario"
 *    - Fuente del evento: "Desde la hoja de cálculo"
 *    - Tipo de evento: "Al enviarse el formulario"
 *    - Guarda y autoriza los permisos requeridos.
 * =========================================================================
 */

// CONFIGURACIÓN PRINCIPAL
const CONFIG = {
  NOMBRE_HOJA: 'Respuestas de formulario 1', // Nombre de la pestaña de respuestas
  MAX_CUPOS_REGULARES: 10,                   // Primeros 10 reciben correo regular
  MAX_CUPOS_TOTALES: 12,                     // Puestos 11 y 12 reciben sobrecupo, y luego se bloquea la fecha
  PREGUNTA_FECHA: '¿Para qué fecha deseas la cita?', // Texto exacto de la pregunta de fecha en el Form
  COL_FECHA: 3,                              // Columna C (índice 3 en Sheets)
  COL_PACIENTE: 4,                           // Columna D (índice 4 en Sheets)
  COL_EMAIL: 18                              // Columna R (índice 18 en Sheets)
};

/**
 * Función principal disparada al enviarse el formulario
 */
function alEnviarFormulario(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.NOMBRE_HOJA) || SpreadsheetApp.getActiveSheet();
    const lastRow = sheet.getLastRow();
    
    if (lastRow < 2) return;
    
    // Obtener los datos de la fila recién insertada
    const filaNueva = sheet.getRange(lastRow, 1, 1, sheet.getLastColumn()).getValues()[0];
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    // Mapear columnas dinámicamente por nombre
    const idxFecha = headers.findIndex(h => h.toString().toLowerCase().includes('fecha'));
    const idxPaciente = headers.findIndex(h => h.toString().toLowerCase().includes('nombre') && h.toString().toLowerCase().includes('paciente'));
    const idxEmail = headers.findIndex(h => h.toString().toLowerCase().includes('correo') || h.toString().toLowerCase().includes('email'));
    const idxMotivo = headers.findIndex(h => h.toString().toLowerCase().includes('motivo'));
    
    const fechaCita = (idxFecha !== -1 ? filaNueva[idxFecha] : filaNueva[CONFIG.COL_FECHA - 1]).toString().trim();
    const nombrePaciente = (idxPaciente !== -1 ? filaNueva[idxPaciente] : filaNueva[CONFIG.COL_PACIENTE - 1]).toString().trim();
    const emailDestino = (idxEmail !== -1 ? filaNueva[idxEmail] : filaNueva[CONFIG.COL_EMAIL - 1]).toString().trim();
    const motivo = (idxMotivo !== -1 ? filaNueva[idxMotivo] : 'Consulta médica').toString().trim();
    
    if (!fechaCita || !emailDestino) {
      Logger.log('Datos incompletos para procesar la fila ' + lastRow);
      return;
    }
    
    // Contar cuántas citas van para esa fecha específica
    const todasLasFilas = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    let totalCitasFecha = 0;
    
    todasLasFilas.forEach(fila => {
      const f = (idxFecha !== -1 ? fila[idxFecha] : fila[CONFIG.COL_FECHA - 1]).toString().trim();
      if (f === fechaCita) {
        totalCitasFecha++;
      }
    });
    
    Logger.log(`Procesando paciente: ${nombrePaciente} | Fecha: ${fechaCita} | Posición: #${totalCitasFecha}`);
    
    // Generar Ticket ID
    const ticketId = generarTicketId();
    
    // 1. Enviar el correo según la posición (1-10 vs 11-12)
    if (totalCitasFecha <= CONFIG.MAX_CUPOS_REGULARES) {
      enviarCorreoRegular(emailDestino, nombrePaciente, fechaCita, ticketId, motivo, totalCitasFecha);
    } else if (totalCitasFecha <= CONFIG.MAX_CUPOS_TOTALES) {
      enviarCorreoSobrecupo(emailDestino, nombrePaciente, fechaCita, ticketId, motivo, totalCitasFecha);
    } else {
      enviarCorreoLimiteExcedido(emailDestino, nombrePaciente, fechaCita);
    }
    
    // 2. Si se alcanzaron o superaron los 12 cupos, bloquear la fecha en el formulario
    if (totalCitasFecha >= CONFIG.MAX_CUPOS_TOTALES) {
      bloquearFechaEnFormulario(fechaCita);
    }
    
  } catch (error) {
    Logger.log('Error en alEnviarFormulario: ' + error.toString());
  }
}

/**
 * Genera un código de ticket único alfanumérico (ej: D4WGPA)
 */
function generarTicketId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ticket = '';
  for (let i = 0; i < 6; i++) {
    ticket += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return ticket;
}

/**
 * Envía correo para los pacientes del 1 al 10 (Cupos Regulares)
 */
function enviarCorreoRegular(email, nombre, fecha, ticketId, motivo, posicion) {
  const asunto = `Ticket de Cita #${ticketId} - Consultorio Dra. Cristina García`;
  
  const htmlBody = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #121824; margin: 0; padding: 20px; color: #f8fafc; }
      .container { max-width: 520px; margin: 0 auto; background-color: #1a2234; border-radius: 16px; border: 1px solid #2d3748; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
      .header { text-align: center; padding: 30px 20px 10px; }
      .subtitle { font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: #94a3b8; margin-bottom: 8px; }
      .title { font-size: 26px; font-weight: 800; color: #60a5fa; margin: 0; }
      .content { padding: 20px 30px; }
      .greeting { font-size: 16px; line-height: 1.6; color: #cbd5e1; margin-bottom: 25px; }
      .card-info { background-color: #111827; border-left: 4px solid #3b82f6; border-radius: 10px; padding: 20px; margin-bottom: 25px; }
      .card-row { display: flex; align-items: center; margin-bottom: 12px; font-size: 15px; }
      .card-row:last-child { margin-bottom: 0; }
      .ticket-box { display: flex; justify-content: space-between; align-items: center; background-color: #0f172a; border-radius: 10px; padding: 15px 20px; margin-bottom: 25px; }
      .ticket-id { font-size: 22px; font-weight: 800; letter-spacing: 2px; color: #f1f5f9; }
      .instructions { font-size: 14px; line-height: 1.6; color: #94a3b8; background-color: #1e293b; padding: 15px; border-radius: 8px; }
      .footer { text-align: center; padding: 20px; font-size: 12px; color: #64748b; border-top: 1px solid #2d3748; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="subtitle">CONSULTORIO MÉDICO - DRA. CRISTINA GARCÍA</div>
        <div class="title">TICKET DE CITA</div>
      </div>
      <div class="content">
        <div class="greeting">
          Hola <strong>${nombre}</strong>,<br>
          Nos alegra confirmarte que tu solicitud de cita médica ha sido procesada con éxito.
        </div>
        
        <div class="card-info">
          <div class="card-row">📅 <strong>Fecha asignada:</strong>&nbsp;${fecha}</div>
          <div class="card-row">⏰ <strong>Hora de llegada:</strong>&nbsp;A partir de las 4:30 PM</div>
          <div class="card-row">🩺 <strong>Motivo:</strong>&nbsp;${motivo}</div>
        </div>
        
        <div class="ticket-box">
          <div>
            <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">TICKET ID</div>
            <div class="ticket-id">${ticketId}</div>
          </div>
          <div style="background-color: #2563eb; color: white; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: bold;">
            Turno #${posicion}
          </div>
        </div>
        
        <div class="instructions">
          <strong>📌 Instrucciones importantes:</strong>
          <ul style="margin: 8px 0 0 0; padding-left: 20px;">
            <li>Debe llegar a partir de las <strong>4:30 PM</strong>, ya que se atenderá por <strong>estricto orden de llegada</strong>.</li>
            <li>Presentar documento de identidad y carnet de seguro (si aplica) en recepción.</li>
          </ul>
        </div>
      </div>
      <div class="footer">
        Dra. Cristina García Domínguez • Pediatra Cardióloga<br>
        Este es un mensaje automático, por favor no responda directamente a este correo.
      </div>
    </div>
  </body>
  </html>
  `;
  
  GmailApp.sendEmail(email, asunto, `Hola ${nombre}, tu cita para el ${fecha} está confirmada. Ticket: ${ticketId}. Llegar a partir de las 4:30 PM.`, {
    htmlBody: htmlBody,
    name: 'Dra. Cristina García'
  });
}

/**
 * Envía correo diferenciado para los pacientes 11 y 12 (Turnos Adicionales / Sobrecupo)
 */
function enviarCorreoSobrecupo(email, nombre, fecha, ticketId, motivo, posicion) {
  const asunto = `⚠️ Turno Adicional / Sobrecupo #${ticketId} - Dra. Cristina García`;
  
  const htmlBody = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #121824; margin: 0; padding: 20px; color: #f8fafc; }
      .container { max-width: 520px; margin: 0 auto; background-color: #1a2234; border-radius: 16px; border: 1px solid #f59e0b; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
      .header { text-align: center; padding: 30px 20px 10px; background: linear-gradient(180deg, rgba(245, 158, 11, 0.15) 0%, transparent 100%); }
      .subtitle { font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: #f59e0b; margin-bottom: 8px; font-weight: bold; }
      .title { font-size: 24px; font-weight: 800; color: #fbbf24; margin: 0; }
      .badge-sobrecupo { display: inline-block; background-color: #d97706; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-top: 8px; }
      .content { padding: 20px 30px; }
      .greeting { font-size: 16px; line-height: 1.6; color: #cbd5e1; margin-bottom: 20px; }
      .card-info { background-color: #111827; border-left: 4px solid #f59e0b; border-radius: 10px; padding: 20px; margin-bottom: 25px; }
      .card-row { display: flex; align-items: center; margin-bottom: 12px; font-size: 15px; }
      .card-row:last-child { margin-bottom: 0; }
      .ticket-box { display: flex; justify-content: space-between; align-items: center; background-color: #0f172a; border-radius: 10px; padding: 15px 20px; margin-bottom: 25px; }
      .ticket-id { font-size: 22px; font-weight: 800; letter-spacing: 2px; color: #fbbf24; }
      .instructions { font-size: 14px; line-height: 1.6; color: #e2e8f0; background-color: #78350f; padding: 18px; border-radius: 8px; border-left: 4px solid #f59e0b; }
      .footer { text-align: center; padding: 20px; font-size: 12px; color: #64748b; border-top: 1px solid #2d3748; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="subtitle">CONSULTORIO MÉDICO - DRA. CRISTINA GARCÍA</div>
        <div class="title">TICKET DE CITA - SOBRECUPO</div>
        <div class="badge-sobrecupo">TURNO ADICIONAL #${posicion} DE 12</div>
      </div>
      <div class="content">
        <div class="greeting">
          Hola <strong>${nombre}</strong>,<br>
          Tu solicitud ha sido recibida y asignada como <strong>Turno Adicional / Sobrecupo</strong> debido a alta demanda.
        </div>
        
        <div class="card-info">
          <div class="card-row">📅 <strong>Fecha asignada:</strong>&nbsp;${fecha}</div>
          <div class="card-row">⏰ <strong>Horario:</strong>&nbsp;Turno Adicional (al finalizar turnos regulares)</div>
          <div class="card-row">🩺 <strong>Motivo:</strong>&nbsp;${motivo}</div>
        </div>
        
        <div class="ticket-box">
          <div>
            <div style="font-size: 11px; color: #f59e0b; text-transform: uppercase;">TICKET SOBRECUPO</div>
            <div class="ticket-id">${ticketId}</div>
          </div>
          <div style="background-color: #d97706; color: white; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: bold;">
            Sobrecupo #${posicion}
          </div>
        </div>
        
        <div class="instructions">
          <strong>⚠️ AVISO IMPORTANTE DE ATENCIÓN:</strong>
          <ul style="margin: 8px 0 0 0; padding-left: 20px;">
            <li>Su cita es un <strong>turno adicional extraordinario</strong>. Será atendido(a) una vez concluyan los 10 pacientes regulares de la tanda.</li>
            <li>Por favor presentarse a partir de las <strong>5:30 PM</strong> y confirmar su llegada con la secretaria.</li>
            <li>Agradecemos su paciencia y comprensión para brindarle la mejor atención médica.</li>
          </ul>
        </div>
      </div>
      <div class="footer">
        Dra. Cristina García Domínguez • Pediatra Cardióloga<br>
        Este es un mensaje automático, por favor no responda directamente a este correo.
      </div>
    </div>
  </body>
  </html>
  `;
  
  GmailApp.sendEmail(email, asunto, `Hola ${nombre}, tu cita para el ${fecha} ha sido asignada como Turno Adicional (Sobrecupo #${posicion}). Ticket: ${ticketId}.`, {
    htmlBody: htmlBody,
    name: 'Dra. Cristina García'
  });
}

/**
 * Notificación si se excede el límite máximo
 */
function enviarCorreoLimiteExcedido(email, nombre, fecha) {
  const asunto = `Aviso sobre tu solicitud de cita - Dra. Cristina García`;
  const mensaje = `Hola ${nombre},\n\nTe informamos que la fecha ${fecha} ya ha alcanzado el límite máximo de pacientes permitidos por el consultorio.\n\nPor favor contáctanos directamente o selecciona una nueva fecha disponible.\n\nAtentamente,\nConsultorio Dra. Cristina García Domínguez`;
  
  GmailApp.sendEmail(email, asunto, mensaje, { name: 'Dra. Cristina García' });
}

/**
 * Modifica las opciones del Google Form para remover la fecha que llegó a 12 cupos
 */
function bloquearFechaEnFormulario(fechaABloquear) {
  try {
    const formUrl = SpreadsheetApp.getActiveSpreadsheet().getFormUrl();
    if (!formUrl) {
      Logger.log('No se encontró URL del formulario vinculado.');
      return;
    }
    
    const form = FormApp.openByUrl(formUrl);
    const items = form.getItems();
    
    items.forEach(item => {
      // Buscar preguntas de tipo Selección Múltiple o Lista Desplegable
      if (item.getTitle().trim() === CONFIG.PREGUNTA_FECHA.trim() || item.getTitle().toLowerCase().includes('fecha')) {
        if (item.getType() === FormApp.ItemType.LIST) {
          const listItem = item.asListItem();
          const choices = listItem.getChoices();
          const newChoices = choices.filter(c => c.getValue().trim() !== fechaABloquear.trim());
          listItem.setChoices(newChoices);
          Logger.log(`✅ Fecha "${fechaABloquear}" removida de la lista desplegable del formulario.`);
        } else if (item.getType() === FormApp.ItemType.MULTIPLE_CHOICE) {
          const mcItem = item.asMultipleChoiceItem();
          const choices = mcItem.getChoices();
          const newChoices = choices.filter(c => c.getValue().trim() !== fechaABloquear.trim());
          mcItem.setChoices(newChoices);
          Logger.log(`✅ Fecha "${fechaABloquear}" removida de las opciones del formulario.`);
        }
      }
    });
  } catch (error) {
    Logger.log('Error al bloquear fecha en el formulario: ' + error.toString());
  }
}

/**
 * Función de mantenimiento: Revisa todas las fechas y bloquea automáticamente
 * en el Google Form cualquier fecha que ya tenga 12 o más citas.
 */
function sincronizarYBloquearFechasLlenas() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.NOMBRE_HOJA) || SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idxFecha = headers.findIndex(h => h.toString().toLowerCase().includes('fecha'));
  const todasLasFilas = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  
  const conteoFechas = {};
  todasLasFilas.forEach(fila => {
    const f = (idxFecha !== -1 ? fila[idxFecha] : fila[CONFIG.COL_FECHA - 1]).toString().trim();
    if (f) {
      conteoFechas[f] = (conteoFechas[f] || 0) + 1;
    }
  });
  
  Logger.log('=== CONTEO DE CITAS POR FECHA ===');
  Object.keys(conteoFechas).forEach(fecha => {
    Logger.log(`${fecha}: ${conteoFechas[fecha]} citas`);
    if (conteoFechas[fecha] >= CONFIG.MAX_CUPOS_TOTALES) {
      Logger.log(`-> Bloqueando fecha llena: ${fecha}`);
      bloquearFechaEnFormulario(fecha);
    }
  });
}
