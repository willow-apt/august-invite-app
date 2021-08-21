const august = require('august-connect')
const express = require('express')
const { v4: uuidv4 } = require('uuid')
const https = require('https')

require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

const DOMAIN = process.env.DOMAIN || 'localhost'
const PORT = process.env.PORT || 3000
const SCHEME = DOMAIN === 'localhost' ? 'http' : 'https'
const BASE_PATH = DOMAIN === 'localhost' ? `${SCHEME}://localhost:${PORT}` : `${SCHEME}://${DOMAIN}`

const app = express()

let tokens = {}

function createExpiration() {
  let expiration = new Date()
  expiration.setFullYear(2030)
  return expiration
}

function createGuestKey(maxEntries, metadata) {
  const token = uuidv4()

  tokens[token] = {
    expiration: createExpiration(),
    maxEntries,
    metadata,
  }

  return token
}

function sendTelegram(message) {
  const data = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text: message
  })

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  }

  const req = https.request(options, res => {
    res.on('data', process.stdout.write.bind(process.stdout))
  })

  req.on('error', console.error)
  req.write(data)
  req.end()
}

function entryMessage(inviteToken) {
  const guestName = tokens[inviteToken].metadata.guestName
  const message = `${guestName} has entered!`
  console.log(message)
  return message
}

function knockMessage(inviteToken) {
  return `Someone's at the door! Click on ${inviteUrl(inviteToken)} to let them in.`
}

function recordEntry(inviteToken) {
  tokens[inviteToken].maxEntries--
}

app.get('/invites', function(_req, res) {
  res.send(tokens)
})

function inviteUrl(token) {
  return `${BASE_PATH}/welcome/${token}`
}

// app.get('/invite/:guestName/:maxEntries', function (req, res) {
//   const guestName = req.params.guestName
//   const maxEntries = req.params.maxEntries
//   const token = createGuestKey(maxEntries, { guestName })
//   res.send(inviteUrl(token))
// })

app.get('/welcome/:inviteToken', function (req, res) {
  const inviteToken = req.params.inviteToken
  const html = `<!DOCTYPE html>
<html>
<body>
    <form action="${inviteUrl(inviteToken)}" method="post">
        <input type="submit" value="Unlock" />
    </form>
</body>
</html>
`
  res.send(html)
})

app.post('/welcome/:inviteToken', function (req, res) {
  const inviteToken = req.params.inviteToken
  const maybeToken = tokens[inviteToken]

  if (!maybeToken) {
    res.send('no')
    return
  }

  const tokenData = tokens[inviteToken]
  if (tokenData.expiration < new Date()) {
    res.send('expired')
    return
  }
  if (tokenData.maxEntries == 0) {
    res.send('used up all entries')
    return
  }

  recordEntry(inviteToken)
  sendTelegram(entryMessage(inviteToken))
  res.send(`Welcome ${tokenData.metadata.guestName}`)
})

app.get('/knock', function (_req, res) {
  const html = `<!DOCTYPE html>
<html>
<body>
  <h1>Welcome to Willow.</h1>
  <p>Please knock and hold for the next available representative.</p>
    <form action="${BASE_PATH}/knock" method="post">
        <input type="submit" value="Knock" />
    </form>
</body>
</html>
`
  res.send(html)
})

app.post('/knock', function (_req, res) {
  const token = createGuestKey(1, { guestName: 'stranger' })
  sendTelegram(knockMessage(token))
  res.send("<p>You've knocked. Please wait to be let in.</p>")
})

app.listen(process.env.PORT || 3000)
