const fs = require('fs');
const path = require('path');

// Referencia estática a la carpeta de plantillas: así el empaquetador de Vercel
// sabe que debe incluir "views/" en el despliegue (las plantillas se leen en tiempo de ejecución).
try {
  fs.readdirSync(path.join(__dirname, '..', 'views'));
} catch {
  /* sin efecto: solo sirve para que el empaquetador detecte la carpeta */
}
