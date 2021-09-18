// https://github.com/willow-apt/august-invite-app

import august from 'august-connect'
import express from 'express'
import { v4 as uuidv4,  validate as uuidValidate } from 'uuid'
import https from 'https'
import { Datastore } from '@google-cloud/datastore'
import { Telegraf } from 'telegraf'
import { Invite } from './contracts'
import moment from 'moment-timezone'


require('dotenv').config();

const LOCK_ID = process.env.LOCK_ID

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

if (TELEGRAM_BOT_TOKEN === undefined || TELEGRAM_CHAT_ID === undefined) {
  console.error(`Missing telegram secrets. Exiting.`);
  process.exit(1);
}

const DOMAIN = process.env.DOMAIN || 'localhost'
const PORT = process.env.PORT || 3000
const PROTOCOL = process.env.PROTOCOL || 'http'
const BASE_PATH = DOMAIN === 'localhost' ? `${PROTOCOL}://localhost:${PORT}` : `${PROTOCOL}://${DOMAIN}`

const bot = new Telegraf(TELEGRAM_BOT_TOKEN)
const datastore = new Datastore()
const app = express()

app.use('/static', express.static('public'))

app.get('/robots.txt', function (req, res) {
  res.type('text/plain');
  res.send("User-agent: *\nDisallow: /");
});

async function saveInvite(inviteToken: string, invite: Invite) {
  const key = datastore.key(['Invite', inviteToken])
  await datastore.save({ key, data: invite })
}

async function createInvite(maxEntries: number, guestName: string, expiration: Date | undefined = undefined) {
  const token = uuidv4()

  if (expiration === undefined) {
    expiration = new Date()
    expiration = moment(expiration).add(30, 'hours').toDate()
  }

  const invite = { expiration, maxEntries, guestName }
  await saveInvite(token, invite)
  return { token, invite }
}

async function getInvite(inviteToken: string) {
  const entities = await datastore.get(datastore.key(['Invite', inviteToken]))
  return entities[0]
}

function sendTelegram(message: string) {
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

function entryMessage(invite: Invite) {
  return `${invite.guestName} has entered!`
}

function inviteUrl(token: string, basePath: string = BASE_PATH) {
  return `${basePath}/welcome/${token}`
}

function knockMessage(inviteToken: string) {
  return `Someone's at the door! Click on ${inviteUrl(inviteToken)} to let them in.`
}

function inviteMessage(inviteToken: string, invite: Invite) {
  const { maxEntries, expiration, guestName } = invite

  return `Here's the invite link for ${guestName}:
${inviteUrl(inviteToken)}
They are permitted a maximum of ${maxEntries} entries.
The link expires ${formatDate(expiration)}.`
}

async function recordEntry(inviteToken: string, invite: Invite) {
  invite.maxEntries--
  console.log(`Invite for token ${inviteToken}: ${invite}`)
  await saveInvite(inviteToken, invite)
}

async function getActiveInvites() {
  const query = datastore
    .createQuery('Invite')
    .filter('maxEntries', '>', 0)

  // For "performance reasons", datastore doesn't allow
  // inequality filtering on more than one property
  // so we do it in here
  const results = (await datastore.runQuery(query))[0]
  const now = new Date()
  return results.filter(invite => invite.expiration > now)
}

function activeInvitesMessage(invites: any[]) { // FIX MY TYPE
  if (invites.length == 0) {
    return 'No active invites. Get more friends!'
  }

  return `The active invites are:
${
invites.map(invite => {
  return `${invite.guestName}
--------------------
GUID: ${invite[datastore.KEY].name.substring(0, 5)}
Remaining Entries: ${invite.maxEntries}
Expiration: ${formatDate(invite.expiration)}
`
}).join('\n')
}
`
}

function formatDate(date: Date): string {
  return moment(date).tz('America/New_York').format('ddd, MMM Do YYYY, h:mm:ss A z')
}

function helpMessage() {
  return `
== Willow Bot ==

Commands:
*  /invite  <guest name>  <# of entries>
     alias: /i

*  /active_invites
     alias: /a /active

*  /delete <regex>
  

Endpoints:
*  ${BASE_PATH}/knock
*  ${BASE_PATH}/welcome/:inviteId
  
`
}

app.get('/welcome/:inviteToken', function (req, res) {
  const inviteToken = req.params.inviteToken

  if (!uuidValidate(inviteToken)) {
    res.send("no thank you")
    return
  }

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
<head>
  <title>Your Invite to Willow</title>
  <meta property="og:title" content="Your Invite to Willow" />
  <meta property="og:image" content="${BASE_PATH}/static/bird_cake.png" />
</head>
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

  if (!uuidValidate(inviteToken)) {
    res.send("no thank you")
    return
  }

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
  res.send(`Welcome!`)
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
  const { token } = await createInvite(1, 'Anonymous Knocker')
  sendTelegram(knockMessage(token))
  res.send("<p>You've knocked. Please wait to be let in.</p>")
})

bot.command('active_invites', async (ctx) => await doGetActiveInvites(ctx));
bot.command('active', async (ctx) => await doGetActiveInvites(ctx));
bot.command('a', async (ctx) => await doGetActiveInvites(ctx));

async function doGetActiveInvites(ctx: any) { // TODO: What is the right type here (and below)?
  ctx.reply(activeInvitesMessage(await getActiveInvites()));
}

bot.command('invite', async (ctx) => await doInviteCmd(ctx));
bot.command('i', async (ctx) => await doInviteCmd(ctx));

async function doInviteCmd(ctx: any) {
  try {
    let [guestName, maxEntries] = ctx.update.message.text.split(' ').slice(1)
    const maxEntriesInt = parseInt(maxEntries)
    const { token, invite } = await createInvite(maxEntriesInt, guestName)
    ctx.reply(inviteMessage(token, invite))
  } catch (error) {
    ctx.reply(`Error processing invite: ${error}`)
  }
}

bot.command('help', async (ctx) => {
  ctx.reply(helpMessage())
})

bot.command('delete', async (ctx) => {
  try {
    const patterns = ctx.update.message.text.split(' ').slice(1)
    const regexs = patterns.map(p => new RegExp(p))
    const query = datastore.createQuery('Invite').select('__key__')
    const allKeys = (await datastore.runQuery(query))[0].map(res => res[datastore.KEY])
    const matches = allKeys.filter(k => regexs.some(r => r.test(k.name)))
    if (matches.length === 0) {
      ctx.reply('No matching invites found')
    } else {
      await datastore.delete(matches)
      ctx.reply(`Deleted invites with the following GUIDS:\n ${matches.map(k => k.name).join('\n')}`)
    }
  } catch (error) {
    ctx.reply(`Error processing delete: ${error}`)
  }
})

bot.launch()
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

app.listen(PORT)
