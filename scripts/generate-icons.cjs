// -*- coding: utf-8 -*-
const fs   = require('fs')
const path = require('path')
const zlib = require('zlib')

const LOGO_PATH = path.join(__dirname, 'logo_jarapo.png')
const OUT_192   = path.join(__dirname, '..', 'public', 'icon-192.png')
const OUT_512   = path.join(__dirname, '..', 'public', 'icon-512.png')

// Leer el logo original
if (!fs.existsSync(LOGO_PATH)) {
  console.error('Logo no encontrado en scripts/logo_jarapo.png')
  process.exit(1)
}

const logoBuffer = fs.readFileSync(LOGO_PATH)

// Para íconos PWA en iOS, el logo debe estar sobre fondo blanco
// y tener esquinas redondeadas. Usamos sharp si está disponible,
// si no, copiamos el logo directamente redimensionado.

// Intentar con sharp (mejor calidad)
try {
  const sharp = require('sharp')

  async function generateWithSharp() {
    // Generar 192x192 con fondo blanco y logo centrado con padding
    await sharp(logoBuffer)
      .resize(192, 192, { fit: 'cover', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toFile(OUT_192)
    console.log('icon-192.png generado con logo real')

    // Generar 512x512
    await sharp(logoBuffer)
      .resize(512, 512, { fit: 'cover', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toFile(OUT_512)
    console.log('icon-512.png generado con logo real')
  }

  generateWithSharp().then(() => {
    console.log('Iconos PWA generados correctamente con el logo de Jarapo')
  }).catch(err => {
    console.error('Error con sharp:', err)
  })

} catch(e) {
  // Si sharp no está disponible, copiar el logo directamente
  console.log('sharp no disponible, copiando logo directamente...')
  fs.copyFileSync(LOGO_PATH, OUT_192)
  fs.copyFileSync(LOGO_PATH, OUT_512)
  console.log('Iconos copiados (sin redimensionar). Instalar sharp para mejor calidad:')
  console.log('npm install sharp --save-dev')
}
