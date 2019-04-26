const express = require('express');
const consola = require('consola');
const { Nuxt, Builder } = require('nuxt');
const app = express();
const rp = require(`request-promise`);

// Import and Set Nuxt.js options
const config = require('../nuxt.config.js')
config.dev = !(process.env.NODE_ENV === 'production')

function mediaWikiListener() {
  console.log(`Starting mediaWikiListener.`);

  return new Promise(async (resolve, reject) => {
    const MongoClient = require('mongodb').MongoClient;

    // Use connect method to connect to the Server
    let db = (await MongoClient.connect(process.env.MONGODB_URI, { useNewUrlParser: true }))
          .db(process.env.MONGODB_DB);

    console.log(`MediaWikiListener started`);
    const EventSource = require('eventsource');
    const url = 'https://stream.wikimedia.org/v2/stream/recentchange';

    console.log(`Connecting to EventStreams at ${url}`);

    const eventSource = new EventSource(url);
    eventSource.onopen = function(event) {
      console.log('--- Opened connection.');
    };

    eventSource.onerror = function(event) {
      console.error('--- Encountered error', event);
    };

    eventSource.onmessage = async function(event) {
      let recentChange = JSON.parse(event.data);
      // console.log(`server received`, data.wiki, data.id, data.meta.uri);
      recentChange._id = (`${recentChange.wiki}-${recentChange.id}`);
      if (recentChange.type === "edit") {
        // Currently only support these wikis.
        if (["enwiki", "frwiki", "ruwiki"].indexOf(recentChange.wiki) >= 0) {
          try {
            let oresUrl = `https://ores.wmflabs.org/v3/scores/${recentChange.wiki}/?models=damaging|goodfaith&revids=${recentChange.revision.new}`;
            let oresJson = await rp.get(oresUrl, { json: true });
            console.log(JSON.stringify(oresJson, null, 2));
            let damaging = oresJson[recentChange.wiki].scores[recentChange.revision.new].damaging.score.probability.true;
            let badfaith = oresJson[recentChange.wiki].scores[recentChange.revision.new].goodfaith.score.probability.false;
            console.log(recentChange);
            await db.collection(`MediaWikiRecentChange`).insertOne({
              _id: recentChange._id,
              id: recentChange.id,
              revision: recentChange.revision,
              title: recentChange.title,
              user: recentChange.user,
              wiki: recentChange.wiki,
              timestamp: recentChange.timestamp,
              ores: {
                damaging: damaging,
                badfaith: badfaith
              }
            });
          } catch (e) {
            if (e.name === "MongoError" && e.code === 11000) {
              console.warn(`Duplicated Key Found`, e.errmsg);
            } else {
              console.error(e);
            }
          }
        }

      }
    };

  });
}
async function start() {
  // Init Nuxt.js
  const nuxt = new Nuxt(config)

  const { host, port } = nuxt.options.server

  // Build only in dev mode
  if (config.dev) {
    const builder = new Builder(nuxt)
    await builder.build()
  } else {
    await nuxt.ready()
  }

  // Give nuxt middleware to express
  app.use(nuxt.render)

  // Listen the server
  app.listen(port, host)
  consola.ready({
    message: `Server listening on http://${host}:${port}`,
    badge: true
  })

  mediaWikiListener();
}
start()
