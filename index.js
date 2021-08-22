const august = require('august-connect')
const express = require('express')
const { v4: uuidv4 } = require('uuid')
const https = require('https')
const { Datastore } = require('@google-cloud/datastore')

require('dotenv').config();

const LOCK_ID = process.env.LOCK_ID

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

const DOMAIN = process.env.DOMAIN || 'localhost'
const PORT = process.env.PORT || 3000
const SCHEME = DOMAIN === 'localhost' ? 'http' : 'https'
const BASE_PATH = DOMAIN === 'localhost' ? `${SCHEME}://localhost:${PORT}` : `${SCHEME}://${DOMAIN}`

const datastore = new Datastore()
const app = express()

async function saveInvite(inviteToken, invite) {
  const key = datastore.key(['Invite', inviteToken])
  await datastore.save({ key, data: invite })
}

async function createInvite(maxEntries, guestName) {
  const token = uuidv4()
  let expiration = new Date()
  expiration.setFullYear(2030)

  const invite = { expiration, maxEntries, guestName }
  await saveInvite(token, invite)
  return { token, invite }
}

async function getInvite(inviteToken) {
  const entities = await datastore.get(datastore.key(['Invite', inviteToken]))
  return entities[0]
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

function entryMessage(invite) {
  return `${invite.guestName} has entered!`
}

function inviteUrl(token) {
  return `${BASE_PATH}/welcome/${token}`
}

function knockMessage(inviteToken) {
  return `Someone's at the door! Click on ${inviteUrl(inviteToken)} to let them in.`
}

function inviteMessage(inviteToken, invite) {
  const { maxEntries, expiration, guestName } = invite

  return `Here's the invite link for ${guestName}:
${inviteUrl(inviteToken)}
They are permitted a maximum of ${maxEntries} entries.
The link expires ${expiration}.`
}

async function recordEntry(inviteToken, invite) {
  invite.maxEntries--
  console.log(`Invite for token ${inviteToken}: ${invite}`)
  await saveInvite(inviteToken, invite)
}

app.get('/invite/:guestName/:maxEntries', async function (req, res) {
  const guestName = req.params.guestName
  const maxEntries = req.params.maxEntries
  const { token, invite } = await createInvite(maxEntries, guestName)
  sendTelegram(inviteMessage(token, invite))
  res.send('invite requested')
})

app.get('/welcome/:inviteToken', function (req, res) {
  const inviteToken = req.params.inviteToken
  const html = `<!DOCTYPE html>
<html>
<style>
.btn {
  display:block;
  width:800px;
  height:800px;
  line-height:80%;
  border: 2px solid #f5f5f5;
  border-radius: 50%;
  color:#f5f5f5;
  text-align:center;
  text-decoration:none;
  background: #555777;
  box-shadow: 0 0 3px gray;
  font-size:150px;
  font-weight:bold;
}
.btn:hover {
    background: #ff0000;
}
</style>
<body>
    <form action="${inviteUrl(inviteToken)}" method="post">
      <button class='btn' type="submit">Unlock</button>
    </form>
</body>
</html>
`
  res.send(html)
})

app.post('/welcome/:inviteToken', async function (req, res) {
  const inviteToken = req.params.inviteToken
  const invite = await getInvite(inviteToken)

  if (!invite) {
    res.send('no')
    return
  }

  if (invite.expiration < new Date()) {
    res.send('expired')
    return
  }
  if (invite.maxEntries == 0) {
    res.send('used up all entries')
    return
  }

  await recordEntry(inviteToken, invite)
  sendTelegram(entryMessage(invite))
  august.unlock({ lockID: LOCK_ID })
  res.send(`Welcome ${invite.guestName}`)
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

app.post('/knock', async function (_req, res) {
  const { token } = await createInvite(1, 'stranger')
  sendTelegram(knockMessage(token))
  res.send("<p>You've knocked. Please wait to be let in.</p>")
})

app.listen(process.env.PORT || 3000)
