// index.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Verificar variables de entorno (no imprimir llaves en consola)
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error('Error: Variables de entorno SUPABASE_URL o SUPABASE_KEY no cargadas');
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

console.log('Servidor arrancando y Supabase configurado');

// --- Helpers de fecha/hora ---

// Devuelve hora actual en Nicaragua en formato HH:MM:SS (24h)
function obtenerHoraNicaragua() {
  const tz = "America/Managua";
  const now = new Date();
  const horaFinal = new Intl.DateTimeFormat("es-NI", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(now);
  return horaFinal; // "HH:MM:SS"
}

// Normaliza diferentes formatos de fecha de entrada a "YYYY-MM-DD" o devuelve null si no válida
function normalizarFechaAISO(fechaInput) {
  if (!fechaInput) return null;
  const s = String(fechaInput).trim();

  // 1) ISO ya: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // 2) DD/MM/YYYY o D/M/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // 3) DD-MM-YYYY o D-M-YYYY
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) {
    const [d, m, y] = s.split('-');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // 4) Intentar parsear con Date (fallback). Si parsea, formatear según zona America/Managua
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    // Usamos Intl para obtener día/mes/año en la zona de Nicaragua
    const tz = "America/Managua";
    const fechaStr = new Intl.DateTimeFormat("es-NI", {
      timeZone: tz,
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(parsed); // formato "DD/MM/YYYY" en es-NI
    const [dia, mes, anio] = fechaStr.split('/');
    return `${anio}-${mes}-${dia}`;
  }

  return null;
}

// --- Rutas ---

app.get('/', (req, res) => {
  res.send('Servidor corriendo y conectado a Supabase!');
});

/**
 * POST /
 * Body esperado (ejemplos):
 * {
 *   accion: "registrar" | "cancelar",            // opcional, por defecto "registrar"
 *   fecha: "YYYY-MM-DD" ,                        // opcional: fecha aplicada a todos los productos (usuario la elige)
 *   productos: [
 *     { producto_id: 1, cantidad: 2, fecha: "DD/MM/YYYY" }, // fecha por producto (opcional)
 *     { producto_id: 2, cantidad: 1 }                        // si no tiene fecha -> usa body.fecha si existe -> si no -> usa fecha actual de Nicaragua
 *   ]
 * }
 */
app.post('/', async (req, res) => {
  const { accion = "registrar", productos, fecha: fechaGlobal } = req.body;

  if (!productos || !Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({ error: 'La lista de productos vendidos es obligatoria' });
  }

  // Normalizar fecha global (si la envía el usuario)
  const fechaGlobalISO = fechaGlobal ? normalizarFechaAISO(fechaGlobal) : null;
  if (fechaGlobal && !fechaGlobalISO) {
    return res.status(400).json({ error: 'Fecha global inválida. Use YYYY-MM-DD o DD/MM/YYYY' });
  }

  // Obtener hora actual de Nicaragua (se usa para todas las filas en esta petición)
  const horaActualNica = obtenerHoraNicaragua();

  // Obtener fecha actual de Nicaragua por defecto (si ni producto ni fecha global la especifican)
  const ahora = new Date();
  const tz = "America/Managua";
  const fechaActualNicaStr = new Intl.DateTimeFormat("es-NI", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(ahora);
  const [diaAct, mesAct, anioAct] = fechaActualNicaStr.split('/');
  const fechaActualISO = `${anioAct}-${mesAct}-${diaAct}`;

  try {
    if (accion === "registrar") {
      // Construir filas teniendo en cuenta: fecha por producto > fecha global > fecha actual de Nicaragua
      const filas = [];
      for (const item of productos) {
        if (!item.producto_id || typeof item.cantidad !== 'number') {
          return res.status(400).json({ error: 'Cada producto necesita producto_id y cantidad (número)' });
        }

        // Prioridad de fecha: item.fecha -> fechaGlobalISO -> fechaActualISO
        let fechaItemISO = null;
        if (item.fecha) {
          fechaItemISO = normalizarFechaAISO(item.fecha);
          if (!fechaItemISO) {
            return res.status(400).json({
              error: `Fecha inválida en producto ${item.producto_id}. Use YYYY-MM-DD o DD/MM/YYYY`
            });
          }
        } else if (fechaGlobalISO) {
          fechaItemISO = fechaGlobalISO;
        } else {
          fechaItemISO = fechaActualISO;
        }

        filas.push({
          producto_id: item.producto_id,
          cantidad: item.cantidad,
          fecha: fechaItemISO,
          hora: horaActualNica
        });
      }

      const { data, error } = await supabase
        .from('ventas')
        .insert(filas);

      if (error) {
        console.error('Error insertando ventas:', error);
        throw error;
      }

      return res.status(200).json({ mensaje: 'Venta registrada correctamente', data });
    } else if (accion === "cancelar") {
      // Lógica de cancelar: se conserva como estaba, iterando por productos y eliminando/ajustando cantidades.
      // NOTA: si deseas que la cancelación respete fecha/hora, podemos ajustar más adelante.
      for (const item of productos) {
        if (!item.producto_id || typeof item.cantidad !== 'number') {
          return res.status(400).json({ error: 'Cada producto necesita producto_id y cantidad (número) para cancelar' });
        }

        let cantidadAEliminar = item.cantidad;

        const { data: filasVentas, error: errSelect } = await supabase
          .from('ventas')
          .select('*')
          .eq('producto_id', item.producto_id)
          .order('fecha', { ascending: true })
          .order('hora', { ascending: true });

        if (errSelect) {
          console.error('Error seleccionando ventas para cancelar:', errSelect);
          throw errSelect;
        }

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

      return res.status(200).json({ mensaje: 'Venta(s) cancelada(s) correctamente' });
    } else {
      return res.status(400).json({ error: 'Acción no reconocida. Use "registrar" o "cancelar"' });
    }
  } catch (err) {
    console.error('Error en la operación:', err);
    return res.status(500).json({ error: 'Error al procesar la operación', detalles: err.message || err });
  }
});

// Iniciar el servidor
app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
