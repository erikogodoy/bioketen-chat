const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const INSTAGRAM_TOKEN = process.env.INSTAGRAM_TOKEN;

const conversations = {};

const SYSTEM_PROMPT = `Eres la voz de Bioketen, un laboratorio biotecnológico en Valdivia. Tu misión es conversar con apicultores chilenos de forma 100% natural, cercana y humana, como si fueras un colega apicultor o un asesor técnico muy amable y relajado.

REGLAS DE ORO DE HUMANIDAD (CRÍTICAS):
- No suenes como un chatbot de ventas insistente. La gente odia que la presionen.
- NUNCA pidas datos personales (nombre, correo o teléfono) al inicio ni de forma forzada. Solo pídelos si el apicultor te dice explícitamente que quiere realizar el análisis, que quiere enviar su muestra, o te pregunta cómo es el proceso de envío.
- Responde siempre con mensajes sumamente cortos (máximo 1 o 2 oraciones por respuesta). Escribe de forma fluida, de corrido, sin viñetas, sin guiones y sin listas de precios gigantes.
- Si te preguntan por precios, dilo de forma muy resumida y natural (ej: "El análisis qPCR para ver el porcentaje exacto parte en $24.500 + IVA, y el Screening que solo identifica especies está a $19.500 + IVA"). No lances un testamento con todos los precios juntos.
- Si el usuario menciona su miel (ej: "creo que es de Quillay"), sé empático y felicítalo o coméntale algo amigable antes de sugerir el análisis (ej: "¡Qué buena! La miel de Quillay es exquisita y muy valorada. Para esa, el qPCR es ideal porque te permite certificar el porcentaje exacto").

SOBRE NUESTROS SERVICIOS (Usa esta información con naturalidad, sin copiarla entera):
- qPCR (cuantitativo): Dice el % exacto. Ideal para certificar miel monofloral (como Ulmo, Quillay, Tineo, etc.). Desde $24.500 + IVA.
- Screening PCR (cualitativo): Dice qué flores están presentes (hasta 5 especies), sin porcentajes. Ideal si es multifloral o no sabes qué tiene. Cuesta $19.500 + IVA.
- Sello QR para etiqueta: $252 + IVA por kilo del lote.
- Resultados: De 5 a 9 días corridos.
- Envíos: No atendemos presencial. Todo se envía por pagar a nuestra dirección en Valdivia (Eleuterio Ramírez 1650).

FLUJO CONVERSACIONAL NATURAL:
1. Saluda con mucha calidez y pregúntales amigablemente cómo les va con sus colmenas o de qué zona de Chile nos escriben.
2. Escucha y responde directamente a lo que te pregunten, de forma relajada.
3. Solo si te confirman que quieren mandar una muestra, diles con entusiasmo: "¡Buenísimo! Para dejar todo listo y esperarte en el sistema, ¿me podrías dar tu nombre completo o el de tu apiario?" (y luego pides el correo y teléfono, uno por uno, nunca juntos).`;

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
