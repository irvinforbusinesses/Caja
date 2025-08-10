const cors = require('cors');
const fs = require('fs');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

// Middlewares
app.use(cors()); // Habilita CORS
app.use(express.json());

// Mostrar contenido del .env en consola (solo para pruebas)
console.log('Contenido del .env:', fs.readFileSync('.env', 'utf8'));
console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY);

// Crear cliente de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Variables de entorno no cargadas correctamente');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('Supabase cliente creado correctamente');

// Ruta básica para comprobar que el servidor funciona
app.get('/', (req, res) => {
  res.send('Servidor corriendo y conectado a Supabase!');
});

// Ruta para registrar ventas
app.post('/', async (req, res) => {
  const { accion = "registrar", vendidos } = req.body;

  if (!vendidos || !Array.isArray(vendidos) || vendidos.length === 0) {
    return res.status(400).json({ error: 'La lista de productos vendidos es obligatoria' });
  }

  const now = new Date();
  const fecha = now.toISOString().slice(0, 10);
  const hora = now.toTimeString().slice(0, 8);

  try {
    if (accion === "registrar") {
      const filas = vendidos.map(item => ({
        producto_id: item.codigo,
        cantidad: item.cantidad,
        fecha,
        hora
      }));

      const { data, error } = await supabase
        .from('ventas')
        .insert(filas);

      if (error) throw error;

      res.status(200).json({ mensaje: 'Venta registrada correctamente', data });
    } else if (accion === "cancelar") {
      for (const item of vendidos) {
        let cantidadAEliminar = item.cantidad;

        const { data: filasVentas, error: errSelect } = await supabase
          .from('ventas')
          .select('*')
          .eq('producto_id', item.codigo)
          .order('fecha', { ascending: true })
          .order('hora', { ascending: true });

        if (errSelect) throw errSelect;

        for (const fila of filasVentas) {
          if (cantidadAEliminar <= 0) break;

          if (fila.cantidad > cantidadAEliminar) {
            const nuevaCantidad = fila.cantidad - cantidadAEliminar;

            const { error: errUpdate } = await supabase
              .from('ventas')
              .update({ cantidad: nuevaCantidad })
              .eq('id', fila.id);

            if (errUpdate) throw errUpdate;

            cantidadAEliminar = 0;
            break;
          } else {
            const { error: errDelete } = await supabase
              .from('ventas')
              .delete()
              .eq('id', fila.id);

            if (errDelete) throw errDelete;

            cantidadAEliminar -= fila.cantidad;
          }
        }
      }

      res.status(200).json({ mensaje: 'Venta cancelada correctamente' });
    } else {
      res.status(400).json({ error: "Acción no reconocida" });
    }
  } catch (err) {
    console.error('Error en la operación:', err.message);
    res.status(500).json({ error: 'Error al procesar la operación' });
  }
});


// Iniciar el servidor
app.listen(port, () => {
console.log(`Servidor escuchando en http://localhost:${port}`);
});



