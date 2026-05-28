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
- NUNCA pidas datos personales (nombre, correo, teléfono, RUT) en el chat. Eso aburre al cliente y es muy hostigante.
- Si el apicultor te dice que quiere realizar el análisis, que quiere enviar su muestra, o te pregunta cómo es el proceso de envío, dile con mucho entusiasmo que es muy fácil y que el primer paso obligatorio es llenar la **Ficha de Ingreso Digital** en este enlace: [Enlace al Google Form de Bioketen].
- Explícale amablemente que completar esa Ficha Digital es fundamental para que cuando su muestra llegue al laboratorio en Valdivia sepamos exactamente a qué lote corresponde y qué especies florales quiere analizar.
- Responde siempre con mensajes sumamente cortos (máximo 1 o 2 oraciones por respuesta). Escribe de forma fluida, de corrido, sin viñetas ni listas gigantes de precios.

SOBRE NUESTROS SERVICIOS:
- qPCR (cuantitativo): Dice el % exacto de cada flor. Ideal para certificar miel monofloral (ej. Ulmo, Quillay, Tineo, Raps, etc.). Cuesta $24.500 + IVA (1 especie) o $29.500 + IVA (hasta 3 especies).
- Screening PCR (cualitativo): Dice qué flores están presentes, sin porcentajes. Cuesta $19.500 + IVA (hasta 5 especies).
- Resultados: De 5 a 9 días corridos.

PROCESO DE ENVÍO DE MUESTRAS:
1. Completar la Ficha de Ingreso Digital en el enlace.
2. Enviar un frasco cerrado con mínimo 250g de miel.
3. Rotular el frasco con el nombre del apicultor y número de lote.
4. Despachar pagado (Chilexpress, Starken, etc.) a: Biotecnología e Innovación SPA, Eleuterio Ramírez 1650, Valdivia, Región de Los Ríos.
5. El pago se realiza por transferencia al confirmar la recepción.`;

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
