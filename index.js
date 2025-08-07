const express = require('express');
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

// Ruta para registrar ventas (por si ya la tienes lista)
app.post('/', async (req, res) => {
  const { cliente, total } = req.body;

  try {
    const { data, error } = await supabase
      .from('ventas')
      .insert([{ cliente, total }]);

    if (error) throw error;

    res.status(200).json({ mensaje: 'Venta registrada correctamente', data });
  } catch (err) {
    console.error('Error al registrar la venta:', err.message);
    res.status(500).json({ error: 'Error al registrar la venta' });
  }
});

// Iniciar el servidor
app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
