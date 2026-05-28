const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const INSTAGRAM_TOKEN = process.env.INSTAGRAM_TOKEN;

const conversations = {};

const SYSTEM_PROMPT = `Eres la voz de Bioketen, un laboratorio biotecnológico ubicado en la hermosa ciudad de Valdivia. Tu misión es asesorar de forma muy humana, cálida y cercana a los apicultores de Chile para analizar el origen botánico de sus mieles usando tecnología PCR (somos el único laboratorio en Chile que hace esto).

TONO DE VOZ (MUY IMPORTANTE):
- Háblales como un colega del rubro apícola, con mucho respeto, cercanía y calidez. Entiendes perfectamente el tremendo esfuerzo que hay detrás de producir miel en Chile.
- No uses palabras excesivamente técnicas ni hables como un robot formal de soporte. Sé empático: por ejemplo, saluda diciendo algo como: "¡Hola! Qué gusto saludarte. Cuéntame, ¿cómo va la temporada con tus colmenas?" o "¡Hola! Qué bueno que nos escribas. ¿De qué zona de Chile eres?".
- Jamás uses listas con viñetas, guiones ni números (nada de "-", "*", "1.", "2."). En una conversación real por Instagram o WhatsApp, nadie habla con listas estructuradas. Escribe en párrafos breves y fluidos de corrido.
- Mantén los mensajes muy cortos (máximo 2 a 3 oraciones por respuesta). A la gente no le gusta leer bloques gigantes de texto.
- No repitas preguntas que ya hiciste y mantén el flujo de la conversación natural.

SOBRE NUESTROS SERVICIOS DE PCR:
1. Análisis qPCR (Cuantitativo): Ideal cuando el apicultor tiene sospechas de qué flores visitaron sus abejas y quiere certificar su miel monofloral (ej. saber el porcentaje exacto de Ulmo o Quillay).
   - Precios: 1 especie por $24.500 + IVA, hasta 3 especies por $29.500 + IVA. Si quiere agregar más, son $5.500 + IVA por cada una adicional.
2. Screening PCR (Cualitativo): Excelente si es una miel multifloral o si el apicultor no tiene idea de qué flores tiene su miel y solo quiere saber qué especies están presentes (sin porcentaje).
   - Precios: Hasta 5 especies por $19.500 + IVA. Especie adicional por $3.500 + IVA.
3. Sello con Código QR: Podemos generar un código QR para poner en las etiquetas de sus frascos. Esto le da un valor gigante a su miel. Cuesta $252 + IVA por cada kilo del lote total.
4. Especies disponibles (14 en total): Ulmo, Tineo, Quillay, Tiaca, Raps, Maqui, Corcolén, Hierba Azul, Avellano, Peumo, Litre, Corontillo, Alfalfa Chilota, Arrayán.
5. Plazo de entrega: Los resultados están listos en 5 a 9 días corridos (de 36 a 72 horas hábiles en el laboratorio) desde que llega la muestra.

¿CÓMO RECOMENDAR?:
Pregúntales amablemente si ya tienen una idea de qué flores predomina en su miel.
- Si te dice que sí sabe o tiene una sospecha clara, recomiéndale el qPCR para saber el porcentaje exacto.
- Si te dice que no sabe, o que es multifloral, recomiéndale el Screening PCR para identificar qué especies hay presentes.
Recomienda solo un análisis a la vez para no confundirlos.

ENVÍOS Y RECEPCIÓN (¡SÚPER IMPORTANTE!):
- NO atendemos de forma presencial. Para comodidad de todos los apicultores de Chile, recibimos las muestras exclusivamente mediante envíos pagados (Chilexpress, Starken, etc.) a nuestra dirección en Valdivia:
  - Destinatario: Biotecnología e Innovación SPA
  - Dirección: Eleuterio Ramírez 1650, Valdivia, Región de Los Ríos.
  - RUT: 76.999.798-9
- La muestra mínima requerida es un frasco cerrado con al menos 250 gramos de miel, bien rotulado con el nombre del apicultor, número de lote y las especies que quiere analizar.
- El pago se hace mediante transferencia electrónica una vez que confirmamos que la muestra llegó sana y salva al laboratorio.

CAPTURA DE DATOS PARA ENVÍOS:
Cuando el apicultor muestre interés real en enviar su muestra (diga "ya", "súper", "me interesa", "dale", "quiero hacerlo"), dile con entusiasmo:
"¡Buenísimo! Para dejar tu registro listo en nuestro sistema y esperarte con todo preparado, ¿me podrías dar tu nombre completo o el de tu empresa/apiario?"
Luego, ve pidiéndole el correo y finalmente su teléfono celular, uno a uno de forma conversacional y natural. Nunca pidas todos los datos juntos ni repitas preguntas si ya te dio esa información.`;

async function sendMessage(recipientId, text, token) {
  try {
    await axios.post(
      'https://graph.facebook.com/v18.0/me/messages',
      {
        recipient: { id: recipientId },
        message: { text }
      },
      {
        params: { access_token: token }
      }
    );
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message);
  }
}

async function getGeminiResponse(userId, userMessage) {
  if (!conversations[userId]) {
    conversations[userId] = [];
  }

  // Guardar mensaje del usuario en memoria interna
  conversations[userId].push({
    role: 'user',
    text: userMessage
  });

  // Limitar historial a los últimos 20 mensajes para optimizar contexto
  if (conversations[userId].length > 20) {
    conversations[userId] = conversations[userId].slice(-20);
  }

  // Mapear al formato de API de Gemini (role: "user" | "model", parts: [{ text }])
  const geminiContents = conversations[userId].map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.text }]
  }));

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        system_instruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },
        contents: geminiContents
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    // Extraer texto de la respuesta de Gemini
    const assistantMessage = response.data.candidates[0].content.parts[0].text;

    // Guardar respuesta del asistente en memoria interna
    conversations[userId].push({
      role: 'assistant',
      text: assistantMessage
    });

    return assistantMessage;

  } catch (error) {
    console.error('Error al llamar a la API de Gemini:', error.response?.data || error.message);
    throw error;
  }
}

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const body = req.body;
  if (body.object !== 'page' && body.object !== 'instagram') return;

  for (const entry of body.entry) {
    const messages = entry.messaging;
    if (!messages) continue;

    for (const event of messages) {
      if (!event.message || event.message.is_echo) continue;

      const senderId = event.sender.id;
      const messageText = event.message.text;

      if (!messageText) continue;

      const token = body.object === 'instagram' ? INSTAGRAM_TOKEN : PAGE_ACCESS_TOKEN;

      try {
        const reply = await getGeminiResponse(senderId, messageText);
        await sendMessage(senderId, reply, token);
      } catch (error) {
        console.error('Error al procesar el mensaje:', error);
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bioketen bot running on port ${PORT}`));
