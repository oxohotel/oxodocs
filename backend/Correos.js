/**
 * Plantilla común de los correos del sistema, con el mismo formato corporativo del correo de recuperación de contraseña:
 * tarjeta crema con borde suave, título verde, detalles dorados. Solo estilos "inline" (los clientes de correo ignoran las hojas de estilo).
 * Todo texto que venga de una persona debe pasar antes por escaparHtmlCorreo_ (backend/Registro.js).
 */

var CORREO_NOMBRE_REMITENTE_ = 'Repositorio OxoHotel';
var CORREO_COLOR_VERDE_ = '#3D5A4C';
var CORREO_COLOR_DORADO_ = '#C4972B';
var CORREO_FUENTE_ = "'Segoe UI', Roboto, Arial, sans-serif";

/** Envuelve el contenido en la tarjeta corporativa. "pie" es el texto pequeño del final (opcional). */
function plantillaCorreo_(titulo, contenidoHtml, pie) {
  return '<div style="font-family: ' + CORREO_FUENTE_ + '; max-width: 540px; margin: 0 auto; padding: 28px; background-color: #FCFBF9; border: 1px solid #E8E3DA; border-radius: 16px; color: #19211E;">' +
    '<div style="text-align: center; margin-bottom: 24px;">' +
      '<h2 style="color: ' + CORREO_COLOR_VERDE_ + '; margin: 0 0 6px; font-size: 22px; font-weight: 800;">' + titulo + '</h2>' +
      '<p style="color: #66706B; font-size: 13px; margin: 0;">Repositorio de Documentos OxoHotel</p>' +
    '</div>' +
    contenidoHtml +
    (pie ? '<p style="font-size: 12px; color: #9EA6A0; line-height: 1.5; margin: 24px 0 0; border-top: 1px solid #E8E3DA; padding-top: 16px;">' + pie + '</p>' : '') +
  '</div>';
}

function parrafoCorreo_(html) {
  return '<p style="font-size: 14px; line-height: 1.6; color: #19211E; margin: 0 0 16px;">' + html + '</p>';
}

/** Etiqueta redondeada. tipo: 'propiedad' (dorada), 'aprobada' (verde) o 'denegada' (roja). El texto debe venir ya escapado. */
function pildoraCorreo_(texto, tipo) {
  const estilos = {
    propiedad: 'background: #FBF4DF; border: 1px solid #E8D59A; color: #6B5316;',
    aprobada: 'background: #E8F1EB; border: 1px solid #CFE0D5; color: #2F4A3C;',
    denegada: 'background: #FBEDEA; border: 1px solid #F0CFC9; color: #B5473A;'
  };
  return '<span style="display: inline-block; margin: 0 6px 6px 0; padding: 5px 12px; border-radius: 999px; font-size: 13px; font-weight: 700; ' + (estilos[tipo] || estilos.propiedad) + '">' + texto + '</span>';
}

/** Cuadro blanco con datos "Etiqueta: valor". filas: [{ etiqueta, html }]. */
function cajaDatosCorreo_(filas) {
  return '<div style="background: #FFFFFF; border: 1px solid #E8E3DA; border-radius: 12px; padding: 16px 18px; margin: 0 0 20px;">' +
    filas.map(function (f, i) {
      return '<div style="' + (i ? 'margin-top: 12px;' : '') + '">' +
        '<div style="font-size: 11px; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase; color: #8A6D1F; margin-bottom: 4px;">' + f.etiqueta + '</div>' +
        '<div style="font-size: 14px; color: #19211E; line-height: 1.5;">' + f.html + '</div>' +
      '</div>';
    }).join('') +
  '</div>';
}

function botonCorreo_(texto, url) {
  return '<div style="text-align: center; margin: 24px 0 8px;">' +
    '<a href="' + url + '" style="display: inline-block; background: ' + CORREO_COLOR_DORADO_ + '; color: #FFFFFF; text-decoration: none; font-size: 14px; font-weight: 800; padding: 13px 28px; border-radius: 10px;">' + texto + '</a>' +
  '</div>';
}

/** Código de seguridad grande, con el mismo recuadro dorado del correo de recuperación. */
function codigoCorreo_(codigo) {
  return '<div style="text-align: center; margin: 28px 0;">' +
    '<div style="display: inline-block; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: ' + CORREO_COLOR_DORADO_ + '; background: #FFFFFF; padding: 14px 28px; border-radius: 12px; border: 2px dashed ' + CORREO_COLOR_DORADO_ + '; box-shadow: 0 4px 12px rgba(196,151,43,0.15);">' + codigo + '</div>' +
  '</div>';
}
