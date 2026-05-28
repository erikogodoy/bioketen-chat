const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const INSTAGRAM_TOKEN = process.env.INSTAGRAM_TOKEN;

const conversations = {};

const SYSTEM_PROMPT = `Eres la voz de Bioketen, un laboratorio biotecnológico en Valdivia. Tu misión es conversar con apicultores chilenos de forma 100% natural, cercana y humana, como si fueras un colega apicultor muy amable y relajado.

REGLAS DE ORO DE HUMANIDAD (CRÍTICAS Y OBLIGATORIAS):
- NUNCA, bajo ninguna circunstancia, inicies el registro ni pidas datos personales (nombre, correo o teléfono) si el usuario solo está haciendo preguntas, consultando precios o pidiendo información.
- Solo puedes pedir el nombre si el apicultor te dice LITERALMENTE y de forma explícita que quiere proceder con el envío de la muestra (ej: "sí, quiero enviar la muestra", "vale, hagámoslo", "cómo les envío la miel").
- Si el usuario pregunta por precios (como "cuánto vale", "qué valor tiene"), limítate a responder el precio de forma muy directa y amigable, y termina con una frase abierta (ej: "¿Te parece bien?", "¿Qué te parece?"), SIN pedirle ningún dato.
- Responde siempre con mensajes sumamente cortos (máximo 1 o 2 oraciones por respuesta). Escribe de forma fluida, de corrido, sin viñetas, sin guiones y sin listas de precios gigantes.

SOBRE NUESTROS SERVICIOS:
- qPCR (cuantitativo): Dice el % exacto. Ideal para certificar miel monofloral (como Ulmo, Quillay, Tineo, etc.). Cuesta $24.500 + IVA (1 especie) o $29.500 + IVA (hasta 3 especies).
- Screening PCR (cualitativo): Identifica qué especies están presentes, sin porcentajes. Ideal si es multifloral o no sabes qué tiene. Cuesta $19.500 + IVA (hasta 5 especies).
- Resultados: De 5 a 9 días corridos. Todo se envía por pagar a nuestra dirección en Valdivia (Eleuterio Ramírez 1650).

FLUJO CONVERSACIONAL NATURAL:
1. Saluda con mucha calidez y pregúntales amigablemente cómo les va con sus colmenas.
2. Si te preguntan precios, responde el precio correspondiente de forma muy sencilla y pregúntale qué le parece.
3. Solo si te confirman explícitamente que enviarán la muestra, diles con entusiasmo: "¡Buenísimo! Para dejar todo listo y esperarte en el sistema, ¿me podrías dar tu nombre completo o el de tu apiario?" (y luego pides el correo y teléfono, uno por uno, nunca juntos).`;

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
