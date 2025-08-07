require('dotenv').config();
const fs = require('fs');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

// Mostrar contenido del .env en consola (solo para pruebas)
console.log('Contenido del .env:', fs.readFileSync('.env', 'utf8'));
console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Variables de entorno no cargadas correctamente');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('Supabase cliente creado correctamente');

// Ruta básica para verificar si el servidor está corriendo
app.get('/', (req, res) => {
  res.send('Servidor corriendo y conectado a Supabase!');
});

// Mantener el servidor vivo
app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
