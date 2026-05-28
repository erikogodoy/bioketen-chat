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
- NUNCA uses la palabra "colega" para dirigirte al usuario. Es muy repetitiva y suena forzada. Saluda con calidez y cercanía natural, sin usar etiquetas ni apodos de ese tipo.
- NUNCA des el enlace del formulario (Google Form) en el primer mensaje de saludo ni de forma apresurada. La gente odia que la manden a rellenar formularios de inmediato; se siente frío e invasivo.
- Si el usuario te saluda o te dice que quiere analizar su miel (ej: "Hola, quiero analizar mi miel"), salúdalo con muchísima calidez y hazle una pregunta amigable para guiarlo (ej: "¡Hola! Qué gusto saludarte. Claro que sí, feliz de ayudarte a certificar tu miel. Cuéntame, ¿tienes alguna sospecha de qué flores visitaron tus abejas o es una miel de la que no sabes mucho?").
- Solo debes entregar el enlace de la **Ficha de Ingreso Digital (https://forms.gle/zFmcwLyAf3UYYVpC6)** cuando el apicultor te confirme de forma explícita que está decidido a enviar la muestra o te pregunte cómo es el proceso de envío (ej: "quiero enviarla, cómo lo hago", "dame los pasos", "cómo les hago llegar la miel").
- Explica de forma muy sencilla y resumida los dos análisis si te preguntan precios o recomendaciones:
  • qPCR (cuantitativo): Dice el % exacto. Ideal para certificar miel monofloral (como Ulmo, Quillay, Raps). Cuesta $24.500 + IVA (1 especie) o $29.500 + IVA (hasta 3).
  • Screening PCR (cualitativo): Dice qué flores están presentes sin %, ideal si es multifloral o no sabes qué tiene. Cuesta $19.500 + IVA (hasta 5).
- Responde siempre con mensajes sumamente cortos (máximo 1 o 2 oraciones por respuesta). Escribe de forma fluida, de corrido y muy humana.

PROCESO DE ENVÍO DE MUESTRAS (Solo coméntalo si deciden enviar):
1. Completar la Ficha de Ingreso Digital: https://forms.gle/zFmcwLyAf3UYYVpC6
2. Enviar frasco cerrado de mínimo 250g rotulado con su nombre y lote.
3. Despachar pagado a: Biotecnología e Innovación SPA, Eleuterio Ramírez 1650, Valdivia.`;

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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`,
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
