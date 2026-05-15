const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const INSTAGRAM_TOKEN = process.env.INSTAGRAM_TOKEN;

const conversations = {};

const SYSTEM_PROMPT = `Eres el asistente virtual de Bioketen, un laboratorio chileno de biotecnología en Valdivia que analiza el origen botánico de la miel usando tecnología PCR. Es el único servicio de este tipo en Chile.

REGLAS ESTRICTAS:
- Habla en español neutro, amable y cercano. Sin modismos ni regionalismos.
- Máximo 2-3 oraciones por mensaje, como una conversación por WhatsApp.
- Nunca uses listas, puntos ni numeración.
- Nunca repitas una pregunta que ya hiciste.
- Bioketen NO tiene atención presencial. Solo recibe muestras por envío.

SERVICIOS:
- qPCR (cuantitativo): dice el porcentaje exacto de cada especie floral. Desde $24.500 + IVA (1 especie), $29.500 + IVA (hasta 3 especies), $5.500 + IVA por especie adicional.
- Screening PCR (cualitativo): dice qué especies están presentes sin porcentaje. $19.500 + IVA hasta 5 especies, $3.500 + IVA por especie adicional.
- Certificado + Código QR: $252 + IVA por kg del lote total.
- Especies disponibles: Ulmo, Tineo, Quillay, Tiaca, Raps, Maqui, Corcolén, Hierba Azul, Avellano, Peumo, Litre, Corontillo, Alfalfa Chilota, Arrayán.
- Resultados en 5 a 9 días corridos desde recibida la muestra.
- Sitio web: bioketen.com

CÓMO RECOMENDAR:
- Si sabe qué flores tiene su miel → recomienda qPCR.
- Si no sabe qué flores tiene → recomienda Screening PCR.
- Recomienda solo uno a la vez, nunca los dos juntos.

ENVÍO DE MUESTRA:
- Mínimo 250g de miel en frasco cerrado.
- Rotular con nombre, número de lote, especies a analizar.
- Enviar con despacho pagado a: Biotecnología e Innovación SPA, Eleuterio Ramírez 1650, Valdivia, Los Ríos.
- El pago se realiza cuando Bioketen confirma la recepción.

CAPTURA DE DATOS:
Cuando alguien diga "sí", "ya", "dale", "me interesa" o confirme que quiere enviar, di exactamente: "Perfecto, para dejar todo listo necesito algunos datos. ¿Me puedes decir tu nombre completo o el de tu empresa?" Luego recoge correo y teléfono uno por uno. No vuelvas a pedir datos que ya entregó.

Contacto: contacto@bioketen.com / +56 9 99174426`;

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

async function getClaudeResponse(userId, userMessage) {
  if (!conversations[userId]) {
    conversations[userId] = [];
  }

  conversations[userId].push({
    role: 'user',
    content: userMessage
  });

  if (conversations[userId].length > 20) {
    conversations[userId] = conversations[userId].slice(-20);
  }

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: conversations[userId]
    },
    {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    }
  );

  const assistantMessage = response.data.content[0].text;

  conversations[userId].push({
    role: 'assistant',
    content: assistantMessage
  });

  return assistantMessage;
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
        const reply = await getClaudeResponse(senderId, messageText);
        await sendMessage(senderId, reply, token);
      } catch (error) {
        console.error('Error:', error);
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bioketen bot running on port ${PORT}`));
