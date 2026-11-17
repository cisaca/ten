// Carga productos de ejemplo para ver cómo se ve la tienda. Solo funciona si no hay productos.
// Uso: npm run seed   (luego puedes borrarlos desde el panel)
const store = require('../db');

const samples = [
  ['Smartphone 128 GB', 'Celulares', 'Usado', 189990, 'disponible', 'Con caja y cargador original'],
  ['Audífonos inalámbricos con cancelación de ruido', 'Audio', 'Nuevo', 79990, 'disponible', 'En su caja, sin uso'],
  ['Notebook 14" 16 GB RAM', 'Computación', 'Usado', 349990, 'reservado', 'Pantalla sin marcas, batería sana'],
  ['Consola de videojuegos + 2 controles', 'Consolas', 'Usado', 229990, 'disponible', 'Funciona perfecto, con cables'],
  ['Teclado mecánico', 'Accesorios', 'Nuevo', 44990, 'disponible', 'Distribución en español'],
  ['Smartwatch', 'Accesorios', 'Reacondicionado', 64990, 'disponible', 'Correa nueva incluida'],
  ['Parlante bluetooth portátil', 'Audio', 'Usado', 34990, 'vendido', 'Sonido limpio, carga completa'],
  ['Monitor 24" Full HD', 'Computación', 'Usado', 89990, 'disponible', 'Sin píxeles muertos']
];

async function main() {
  if ((await store.countProducts()) > 0) {
    console.log('Ya hay productos cargados; no se agregó nada.');
    return;
  }
  for (const [title, category, item_condition, price, status, note] of samples) {
    await store.createProduct({
      title,
      category,
      item_condition,
      price,
      status,
      note,
      description: 'Producto de ejemplo. Edita o elimina este texto desde el panel de administración.',
      includes: '',
      flaws: ''
    });
  }
  console.log(`Se cargaron ${samples.length} productos de ejemplo.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('No se pudo cargar los ejemplos:', err.message);
    process.exit(1);
  }
);
