// ==========================================
// ⚙️ GOOGLE FORM: GESTIÓN DE CUPOS (10/12), TICKETS, CORREOS Y BLOQUEO AUTOMÁTICO
// ==========================================
var ID_DEL_FORMULARIO = '1r5Jxyf-sd7Fn_CmbgCfIXr4YsWO74Lwzt70BZ-g4xt4';
var EMAIL_ADMINISTRADOR = 'dragarciadguez@gmail.com'; 
var WEBHOOK_URL = "http://localhost:3001/api/webhook/google-forms"; // Cambiar en producción
var TELEFONO_WHATSAPP = "18095953494"; 
var ZONA_HORARIA = "America/Santo_Domingo"; 
var LINK_MAPS = "https://maps.app.goo.gl/z2tn4j7KBUvq7QrZA";

// ==========================================
// 🚀 FUNCIÓN PRINCIPAL (ACTIVADOR AL ENVIAR FORMULARIO)
// ==========================================
function onFormSubmit(e) {
  try {
    if (e) {
      procesarRegistro(e);
    } else {
      Logger.log("Ejecución manual detectada. Por favor, llene el formulario real para probar.");
    }
  } catch (error) {
    Logger.log("Error general en onFormSubmit: " + error.toString());
  }
}

// ==========================================
// 🧠 LÓGICA CENTRAL OPTIMIZADA
// ==========================================
function procesarRegistro(e) {
  var formulario = FormApp.openById(ID_DEL_FORMULARIO);
  var emailDestino = e.response.getRespondentEmail();
  var respuestas = e.response.getItemResponses();
  
  if (!emailDestino || respuestas.length < 2) return;

  var fechaSeleccionada = respuestas[0].getResponse(); 
  var nombreUsuario = respuestas[1].getResponse(); 
  var tituloPreguntaFecha = respuestas[0].getItem().getTitle();

  // Calculamos el historial una sola vez (Ultra Rápido)
  var conteoFechas = obtenerConteoFechasGlobal(formulario, tituloPreguntaFecha);
  var contadorCitasDia = conteoFechas[fechaSeleccionada] || 0;

  // 🚨 1. Alerta de Agenda Llena para Administrador al llegar a 12 o más
  if (contadorCitasDia >= 12) {
    enviarAlertaAdmin(emailDestino, fechaSeleccionada, respuestas);
  }

  // 📧 2. Enviar correo del ticket al paciente (1-10: Confirmado / 11-12: Sobrecupo / Espera)
  enviarCorreoPaciente(emailDestino, nombreUsuario, fechaSeleccionada, contadorCitasDia);

  // 📡 3. Integración Webhook
  enviarAlSistemaMedico(respuestas, emailDestino);

  // 📅 4. Recalcular y bloquear fechas llenas en el formulario
  actualizarFechasDisponibles(formulario, conteoFechas);
}

// ==========================================
// 🚨 ALERTA AL ADMINISTRADOR (CUPO LLENO)
// ==========================================
function enviarAlertaAdmin(emailDestino, fechaSeleccionada, respuestas) {
  var detallesPacienteHTML = "<div style='background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; margin-top: 25px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.02);'>";
  detallesPacienteHTML += "<div style='background: #f8fafc; padding: 12px 20px; border-bottom: 1px solid #e2e8f0;'><h3 style='color: #1e293b; margin: 0; font-size: 15px; text-align: left;'>📋 Ficha del Paciente (Lista de espera / Sobrecupo)</h3></div>";
  detallesPacienteHTML += "<table width='100%' cellpadding='0' cellspacing='0' style='font-size: 13px; text-align: left; line-height: 1.5;'>";
  
  detallesPacienteHTML += "<tr><td style='padding: 10px 20px; border-bottom: 1px solid #f1f5f9; width: 40%; color: #64748b; vertical-align: top;'>Correo Electrónico</td>";
  detallesPacienteHTML += "<td style='padding: 10px 20px; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-weight: bold; vertical-align: top;'>" + emailDestino + "</td></tr>";
  
  for (var i = 0; i < respuestas.length; i++) {
    var pregunta = respuestas[i].getItem().getTitle();
    var respuesta = respuestas[i].getResponse();
    if (respuesta) {
      detallesPacienteHTML += "<tr><td style='padding: 10px 20px; border-bottom: 1px solid #f1f5f9; width: 40%; color: #64748b; vertical-align: top;'>" + pregunta + "</td>";
      detallesPacienteHTML += "<td style='padding: 10px 20px; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-weight: bold; vertical-align: top;'>" + respuesta + "</td></tr>";
    }
  }
  detallesPacienteHTML += "</table></div>";

  var estiloAdmin = "body{font-family:'Segoe UI',Helvetica,Arial,sans-serif;background-color:#f4f7f6;padding:20px;}.tarjeta{max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:30px;border-top:6px solid #d9534f;box-shadow:0 8px 16px rgba(0,0,0,0.08);text-align:center;}";
  
  var htmlAdmin = 
    "<html><head><style>" + estiloAdmin + "</style></head><body>" +
    "<div class='tarjeta'>" +
    "<div style='font-size: 45px; margin-bottom: 10px;'>🚨</div>" +
    "<h2 style='color: #d9534f; margin-top: 0;'>Día Completamente Lleno</h2>" +
    "<p style='color: #555; font-size: 16px;'>El sistema automático informa que se ha alcanzado el límite de <b>12 pacientes</b> para la siguiente fecha:</p>" +
    "<div style='background: #fdf2f2; border: 1px solid #fadcdc; border-radius: 8px; padding: 15px; margin: 20px 0; font-size: 20px; color: #b52b27; font-weight: bold;'>" +
    "📅 " + fechaSeleccionada +
    "</div>" +
    detallesPacienteHTML + 
    "<p style='color: #888; font-size: 13px; margin-top: 25px;'>El sistema cerrará automáticamente esta fecha en el formulario para evitar sobrecupos adicionales.</p>" +
    "</div></body></html>";

  MailApp.sendEmail({
    to: EMAIL_ADMINISTRADOR,
    subject: "🚨 ALERTA: Cupo máximo alcanzado (" + fechaSeleccionada + ") - Datos de contacto",
    htmlBody: htmlAdmin
  });
}

// ==========================================
// 📨 ENVIAR CORREO (TICKET Y LISTA DE ESPERA)
// ==========================================
function enviarCorreoPaciente(emailDestino, nombreUsuario, fechaSeleccionada, contador) {
  var asunto = "";
  var cuerpoMensajeHTML = "";

  var estiloBase = 
    "body { font-family: 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #f8f9fa; padding: 20px; margin: 0; color: #333333; }" +
    ".tarjeta { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 35px; box-shadow: 0 8px 24px rgba(0,0,0,0.06); text-align: center; border-top: 6px solid #0056b3; }" +
    ".tarjeta-espera { border-top-color: #e67e22; }" + 
    ".boton-whatsapp { display: inline-block; background-color: #25d366; color: #ffffff !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; margin-top: 25px; box-shadow: 0 4px 10px rgba(37,211,102,0.3); transition: background 0.3s; }" +
    ".info-box { background: #f0f7ff; border-radius: 8px; padding: 20px; margin: 25px 0; text-align: left; border-left: 5px solid #0056b3; }" +
    ".info-box-espera { background: #fffaf0; border-left-color: #e67e22; }" +
    ".lista-instrucciones { text-align: left; font-size: 14px; color: #555; padding-left: 20px; line-height: 1.6; }";

  if (contador <= 10) {
    // 🟢 PACIENTES 1 AL 10 (CONFIRMADOS REGULARES)
    var idTicket = Math.random().toString(36).substring(2, 8).toUpperCase();
    var linkCalendario = generarLinkCalendario(fechaSeleccionada, nombreUsuario, idTicket);
    var mensajeWaConfirmado = encodeURIComponent("Hola, mi nombre es " + nombreUsuario + ". Tengo una consulta sobre mi cita confirmada para el " + fechaSeleccionada + " (ID: " + idTicket + ").");
    var linkWhatsAppConfirmado = "https://wa.me/" + TELEFONO_WHATSAPP + "?text=" + mensajeWaConfirmado;

    asunto = "✅ ¡Tu cita está confirmada, " + nombreUsuario + "!";
    cuerpoMensajeHTML =
      "<html><head><style>" + estiloBase + "</style></head><body>" +
      "<div class='tarjeta'>" +
      "<h3 style='color: #777; margin-top: 0; margin-bottom: 5px; font-weight: normal; text-transform: uppercase; font-size: 14px;'>Consultorio Médico - Dra. García</h3>" +
      "<h2 style='color: #0056b3; margin-top: 0; font-size: 26px;'>TICKET DE CITA</h2>" +
      "<p style='font-size: 16px; color: #444; margin-top: 20px;'>Hola <b>" + nombreUsuario + "</b>, nos alegra confirmarte que tu solicitud ha sido procesada con éxito.</p>" +
      
      "<div class='info-box'>" +
      "<div style='margin-bottom: 10px; font-size: 16px;'>📅 <b>Fecha asignada:</b> " + fechaSeleccionada + "</div>" +
      "<div style='font-size: 16px;'>🕒 <b>Hora de llegada:</b> A partir de las 4:30 PM</div>" +
      "</div>" +
      
      "<table width='100%' cellpadding='0' cellspacing='0' style='background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; margin: 25px 0;'><tr>" +
      "<td style='padding: 15px; text-align: center; border-right: 1px solid #e2e8f0; width: 33%;'>" +
      "<span style='font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 4px;'>Ticket ID</span>" +
      "<strong style='font-size: 18px; color: #2d3748;'>" + idTicket + "</strong>" +
      "</td>" +
      "<td style='padding: 15px; text-align: center; border-right: 1px solid #e2e8f0; width: 33%;'>" +
      "<a href='" + linkCalendario + "' target='_blank' style='background: #4285F4; color: #ffffff !important; text-decoration: none; padding: 10px 10px; border-radius: 6px; font-size: 12px; font-weight: bold; display: inline-block; box-shadow: 0 2px 5px rgba(66,133,244,0.2); width: 85%;'>📅 Calendario</a>" +
      "</td>" +
      "<td style='padding: 15px; text-align: center; width: 33%;'>" +
      "<a href='" + LINK_MAPS + "' target='_blank' style='background: #34a853; color: #ffffff !important; text-decoration: none; padding: 10px 10px; border-radius: 6px; font-size: 12px; font-weight: bold; display: inline-block; box-shadow: 0 2px 5px rgba(52,168,83,0.2); width: 85%;'>📍 Mapa</a>" +
      "</td>" +
      "</tr></table>" +
      
      "<h4 style='color: #333; text-align: left; margin-bottom: 10px;'>Instrucciones importantes:</h4>" +
      "<ul class='lista-instrucciones'>" +
      "<li>Debe llegar <b>a partir de las 4:30 PM</b>, ya que se atenderá por orden de llegada.</li>" +
      "<li>Favor traer su cédula y carnet de seguro (si aplica).</li>" +
      "<li>Si necesita reagendar o cancelar, notifíquenos lo antes posible.</li>" +
      "</ul>" +
      
      "<a href='" + linkWhatsAppConfirmado + "' target='_blank' class='boton-whatsapp'>💬 Consultas por WhatsApp</a>" +
      "<p style='color: #999; font-size: 12px; margin-top: 25px; border-top: 1px solid #eee; padding-top: 20px;'>Este correo sirve como pase único, personal e intransferible.</p>" +
      "</div></body></html>";
      
  } else {
    // 🟠 PACIENTES 11 Y 12 (SOBRECUPO / LISTA DE ESPERA)
    var mensajeWaEspera = encodeURIComponent("Hola, mi nombre es " + nombreUsuario + ". El sistema me indicó que estoy en lista de espera prioritaria para el " + fechaSeleccionada + ". Quisiera validar mi cupo.");
    var linkWhatsAppEspera = "https://wa.me/" + TELEFONO_WHATSAPP + "?text=" + mensajeWaEspera;

    asunto = "⏳ Acción requerida: Lista de espera - " + nombreUsuario;
    cuerpoMensajeHTML =
      "<html><head><style>" + estiloBase + "</style></head><body>" +
      "<div class='tarjeta tarjeta-espera'>" +
      "<div style='font-size: 40px; margin-bottom: 10px;'>⏳</div>" +
      "<h2 style='color: #e67e22; margin-top: 0;'>Hola, " + nombreUsuario + "</h2>" +
      "<p style='font-size: 16px; color: #555;'>Hemos recibido correctamente tu solicitud para el <b>" + fechaSeleccionada + "</b>.</p>" +
      
      "<div class='info-box info-box-espera'>" +
      "<strong style='color: #d35400; font-size: 16px;'>Estado: Pendiente de Confirmación (Turno adicional #" + contador + " de 12)</strong><br><br>" +
      "<span style='color: #666; line-height: 1.5;'>Actualmente, la fecha seleccionada cuenta con una alta demanda. Hemos reservado tu lugar en nuestra <b>lista de espera prioritaria / turno adicional</b>.</span>" +
      "</div>" +
      
      "<p style='font-size: 15px; color: #444; margin-bottom: 5px;'>Para validar tu cupo o coordinar tu atención luego de los 10 turnos regulares, comunícate con nuestro equipo:</p>" +
      
      "<a href='" + linkWhatsAppEspera + "' target='_blank' class='boton-whatsapp'>💬 Validar Cita por WhatsApp</a>" +
      "<p style='color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;'>Agradecemos tu comprensión y paciencia.</p>" +
      "</div></body></html>";
  }

  MailApp.sendEmail({
    to: emailDestino,
    subject: asunto,
    htmlBody: cuerpoMensajeHTML
  });
}

// ==========================================
// 📅 ACTUALIZAR FECHAS EN EL FORMULARIO (COMPATIBLE CON ACTIVADOR TEMPORAL Y ONFORMSUBMIT)
// ==========================================
function actualizarFechasDisponibles(formulario, conteoFechas) {
  try {
    // Si la función es ejecutada por el activador de reloj, inicializar formulario y conteo automáticamente
    if (!formulario || typeof formulario.getItems !== 'function') {
      formulario = FormApp.openById(ID_DEL_FORMULARIO);
    }

    var items = formulario.getItems(); 
    var itemPreguntaFecha = null;
    var tituloPregunta = "";

    // Busca la pregunta de fecha de forma universal (sea Lista o Selección Múltiple)
    for (var i = 0; i < items.length; i++) {
      var tit = items[i].getTitle();
      if (tit.toLowerCase().includes("fecha") && tit.toLowerCase().includes("cita")) {
        itemPreguntaFecha = items[i];
        tituloPregunta = tit;
        break;
      }
    }

    if (!itemPreguntaFecha) return;

    if (!conteoFechas || typeof conteoFechas !== 'object') {
      conteoFechas = obtenerConteoFechasGlobal(formulario, tituloPregunta);
    }

    var opcionesFechas = [];
    var hoy = new Date();
    var contadorDias = 0;

    var hoyStr = Utilities.formatDate(hoy, ZONA_HORARIA, "yyyy-MM-dd");
    var horaActualRD = parseInt(Utilities.formatDate(hoy, ZONA_HORARIA, "HH"), 10);

    // Buscar solo hasta 365 días para evitar bloqueos
    while (opcionesFechas.length < 10 && contadorDias < 365) {
      var fechaFutura = new Date(hoy);
      fechaFutura.setDate(hoy.getDate() + contadorDias);
      var fechaFuturaStr = Utilities.formatDate(fechaFutura, ZONA_HORARIA, "yyyy-MM-dd");

      // 🛑 Límite 3:00 PM (15:00 horas en RD): no mostrar el día de hoy después de las 3:00 PM
      if (fechaFuturaStr === hoyStr && horaActualRD >= 15) {
        contadorDias++;
        continue;
      }

      var diaSemana = fechaFutura.getDay();
      if (diaSemana === 2 || diaSemana === 4) { // Solo Martes (2) y Jueves (4)
        var dias = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
        var meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

        var diaTexto = dias[fechaFutura.getDay()];
        var numeroDia = fechaFutura.getDate().toString().padStart(2, "0");
        var mesTexto = meses[fechaFutura.getMonth()];
        var anio = fechaFutura.getFullYear();
        var fechaTexto = diaTexto + " " + numeroDia + " de " + mesTexto + " de " + anio;

        var citasRegistradas = conteoFechas[fechaTexto] || 0;
        
        // Límite ajustado a 12 pacientes máximos (si ya tiene 12 o más, no se añade a las opciones)
        if (citasRegistradas < 12) {
          opcionesFechas.push(fechaTexto);
        }
      }
      contadorDias++;
    }

    if (opcionesFechas.length > 0) {
      if (itemPreguntaFecha.getType() === FormApp.ItemType.LIST) {
        itemPreguntaFecha.asListItem().setChoiceValues(opcionesFechas);
      } else if (itemPreguntaFecha.getType() === FormApp.ItemType.MULTIPLE_CHOICE) {
        itemPreguntaFecha.asMultipleChoiceItem().setChoiceValues(opcionesFechas);
      }
      Logger.log("Opciones de fechas actualizadas exitosamente: " + opcionesFechas.length + " fechas disponibles.");
    }
  } catch (error) {
    Logger.log("Error en actualizarFechasDisponibles: " + error.toString());
  }
}

// ==========================================
// 📡 ENVIAR AL SISTEMA MÉDICO
// ==========================================
function enviarAlSistemaMedico(respuestas, emailDestino) {
  if (WEBHOOK_URL.indexOf("localhost") !== -1) return; // Evita bloqueos locales

  try {
    var datos = {
      timestamp: Utilities.formatDate(new Date(), ZONA_HORARIA, "yyyy-MM-dd'T'HH:mm:ss"),
      fechaCita: respuestas[0] ? respuestas[0].getResponse() : "",
      nombrePaciente: respuestas[1] ? respuestas[1].getResponse() : "",
      email: emailDestino || ""
    };

    UrlFetchApp.fetch(WEBHOOK_URL, {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify(datos),
      muteHttpExceptions: true
    });
  } catch (error) {
    Logger.log("Error de conexión al webhook: " + error.toString());
  }
}

// ==========================================
// 📊 EXTRACCIÓN SÚPER RÁPIDA DE DATOS
// ==========================================
function obtenerConteoFechasGlobal(formulario, tituloPreguntaFecha) {
  var conteo = {};
  var items = formulario.getItems();
  var idPregunta = null;
  
  for (var k = 0; k < items.length; k++) {
    if (items[k].getTitle() === tituloPreguntaFecha) {
      idPregunta = items[k].getId();
      break;
    }
  }

  if (!idPregunta) return conteo;

  var respuestasFormulario = formulario.getResponses();
  
  for (var i = 0; i < respuestasFormulario.length; i++) {
    var itemResponses = respuestasFormulario[i].getItemResponses();
    for (var j = 0; j < itemResponses.length; j++) {
      if (itemResponses[j].getItem().getId() === idPregunta) {
        var fecha = itemResponses[j].getResponse();
        if (fecha) {
          conteo[fecha] = (conteo[fecha] || 0) + 1;
        }
        break; 
      }
    }
  }
  return conteo;
}

// ==========================================
// 📆 GENERADOR DE LINK PARA GOOGLE CALENDAR
// ==========================================
function generarLinkCalendario(fechaTexto, nombreUsuario, idTicket) {
  var meses = {"Enero":"01", "Febrero":"02", "Marzo":"03", "Abril":"04", "Mayo":"05", "Junio":"06", "Julio":"07", "Agosto":"08", "Septiembre":"09", "Octubre":"10", "Noviembre":"11", "Diciembre":"12"};
  
  var partes = fechaTexto.split(" ");
  if (partes.length < 6) return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Cita+Medica"; 
  
  var dia = partes[1].padStart(2, '0');
  var mesTexto = partes[3];
  var anio = partes[5];
  var mes = meses[mesTexto];

  // 4:30 PM en República Dominicana (UTC-4) equivale a 20:30 UTC
  var fechaInicio = anio + mes + dia + "T203000Z";
  var fechaFin = anio + mes + dia + "T213000Z"; 
  
  var titulo = encodeURIComponent("Cita Médica - Dra. García");
  var detalles = encodeURIComponent("Paciente: " + nombreUsuario + "\nID de Confirmación: " + idTicket + "\n\nDebe llegar a partir de las 4:30 PM, ya que se atenderá por orden de llegada.");
  
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + titulo + "&dates=" + fechaInicio + "/" + fechaFin + "&details=" + detalles;
}

// ==========================================
// ⏰ MÓDULO DE RECORDATORIOS AUTOMÁTICOS
// ==========================================
function enviarRecordatoriosDiarios() {
  var hoy = new Date();
  
  // Calcular la fecha exacta de "mañana"
  var manana = new Date(hoy);
  manana.setDate(hoy.getDate() + 1);
  
  var diaSemana = manana.getDay();
  // Detener la ejecución si mañana no es Martes (2) o Jueves (4)
  if (diaSemana !== 2 && diaSemana !== 4) return; 

  var dias = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
  var meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  var diaTexto = dias[diaSemana];
  var numeroDia = manana.getDate().toString().padStart(2, "0");
  var mesTexto = meses[manana.getMonth()];
  var anio = manana.getFullYear();
  
  // Formatear la fecha para que coincida exactamente con las opciones del formulario
  var fechaMananaTexto = diaTexto + " " + numeroDia + " de " + mesTexto + " de " + anio;
  
  var formulario = FormApp.openById(ID_DEL_FORMULARIO);
  var respuestasFormulario = formulario.getResponses();
  var pacientesManana = [];
  
  // Buscar a los pacientes que seleccionaron la fecha de mañana
  for (var i = 0; i < respuestasFormulario.length; i++) {
    var resp = respuestasFormulario[i];
    var itemResponses = resp.getItemResponses();
    if (itemResponses.length >= 2) {
      var fechaSeleccionada = itemResponses[0].getResponse();
      if (fechaSeleccionada === fechaMananaTexto) {
        pacientesManana.push({
          email: resp.getRespondentEmail(),
          nombre: itemResponses[1].getResponse()
        });
      }
    }
  }
  
  // Filtrar estrictamente a los primeros 10 (Confirmados)
  var confirmados = pacientesManana.slice(0, 10);
  
  for (var j = 0; j < confirmados.length; j++) {
    var paciente = confirmados[j];
    if (paciente.email) {
      enviarCorreoRecordatorio(paciente.email, paciente.nombre, fechaMananaTexto);
    }
  }
}

function enviarCorreoRecordatorio(emailDestino, nombreUsuario, fecha) {
  var asunto = "⏰ Recordatorio de su cita médica para mañana";
  var estiloBase = 
    "body { font-family: 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #f8f9fa; padding: 20px; margin: 0; color: #333333; }" +
    ".tarjeta { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 35px; box-shadow: 0 8px 24px rgba(0,0,0,0.06); text-align: center; border-top: 6px solid #34a853; }" +
    ".boton-whatsapp { display: inline-block; background-color: #25d366; color: #ffffff !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; margin-top: 25px; box-shadow: 0 4px 10px rgba(37,211,102,0.3); transition: background 0.3s; }";

  var mensajeWa = encodeURIComponent("Hola, necesito hacer una consulta de seguimiento sobre mi cita de mañana " + fecha + ".");
  var linkWhatsApp = "https://wa.me/" + TELEFONO_WHATSAPP + "?text=" + mensajeWa;

  var cuerpoMensajeHTML =
    "<html><head><style>" + estiloBase + "</style></head><body>" +
    "<div class='tarjeta'>" +
    "<div style='font-size: 40px; margin-bottom: 10px;'>📅</div>" +
    "<h2 style='color: #34a853; margin-top: 0;'>Recordatorio de Cita</h2>" +
    "<p style='font-size: 16px; color: #444; margin-top: 20px;'>Hola <b>" + nombreUsuario + "</b>, le recordamos que tiene una cita médica confirmada para el día de mañana.</p>" +
    
    "<div style='background: #e8f5e9; border-radius: 8px; padding: 20px; margin: 25px 0; text-align: left; border-left: 5px solid #34a853;'>" +
    "<div style='margin-bottom: 10px; font-size: 16px;'>📅 <b>Fecha:</b> " + fecha + "</div>" +
    "<div style='font-size: 16px;'>🕒 <b>Hora de llegada:</b> A partir de las 4:30 PM</div>" +
    "</div>" +
    
    "<p style='font-size: 15px; color: #555; margin-bottom: 25px;'>Por favor, recuerde llegar <b>a partir de las 4:30 PM</b>, ya que se atenderá por orden de llegada. Si se presenta algún inconveniente y no puede asistir, notifíquenos lo antes posible para poder ceder su turno a un paciente en la lista de espera.</p>" +
    
    "<table width='100%' cellpadding='0' cellspacing='0'><tr>" +
    "<td style='padding: 5px; text-align: center; width: 50%;'>" +
    "<a href='" + LINK_MAPS + "' target='_blank' style='background: #4285F4; color: #ffffff !important; text-decoration: none; padding: 12px; border-radius: 6px; font-size: 14px; font-weight: bold; display: inline-block; width: 85%; box-shadow: 0 2px 5px rgba(66,133,244,0.3);'>📍 Ver Mapa</a>" +
    "</td>" +
    "<td style='padding: 5px; text-align: center; width: 50%;'>" +
    "<a href='" + linkWhatsApp + "' target='_blank' style='background: #25d366; color: #ffffff !important; text-decoration: none; padding: 12px; border-radius: 6px; font-size: 14px; font-weight: bold; display: inline-block; width: 85%; box-shadow: 0 2px 5px rgba(37,211,102,0.3);'>💬 Contactar</a>" +
    "</td>" +
    "</tr></table>" +

    "</div></body></html>";

  MailApp.sendEmail({
    to: emailDestino,
    subject: asunto,
    htmlBody: cuerpoMensajeHTML
  });
}
