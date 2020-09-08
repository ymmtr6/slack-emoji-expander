// `cp _env .env` then modify it
// See https://github.com/motdotla/dotenv
const config = require("dotenv").config().parsed;
// Overwrite env variables anyways
for (const k in config) {
  process.env[k] = config[k];
}

// echo-sd
const execSync = require("child_process").execSync;

const mongoose = require("mongoose");
const model = require("./model.js");

const axios = require('axios');
const request = require("request");
const { LogLevel } = require("@slack/logger");
const logLevel = process.env.SLACK_LOG_LEVEL || LogLevel.DEBUG;

const { App, ExpressReceiver } = require("@slack/bolt");
const { debug } = require("request");
// If you deploy this app to FaaS, turning this on is highly recommended
// Refer to https://github.com/slackapi/bolt/issues/395 for details
const processBeforeResponse = false;

// DB
mongoose.connect(process.env.DB_URI || "mongodb://root:example@192.168.11.8:27017/slack?authSource=admin", {
  useNewUrlParser: true,
  useCreateIndex: true,
  useUnifiedTopology: true
}).catch(e => console.log("MongoDB connection Error: ", e));
const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", () => console.log("mongodb Connected."));

let emoji_dict = {};

// Manually instantiate to add external routes afterwards
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  processBeforeResponse,
});
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  logLevel,
  receiver,
  processBeforeResponse,
});

// Request dumper middleware for easier debugging
if (process.env.SLACK_REQUEST_LOG_ENABLED === "1") {
  app.use(async (args) => {
    const copiedArgs = JSON.parse(JSON.stringify(args));
    copiedArgs.context.botToken = 'xoxb-***';
    if (copiedArgs.context.userToken) {
      copiedArgs.context.userToken = 'xoxp-***';
    }
    copiedArgs.client = {};
    copiedArgs.logger = {};
    args.logger.debug(
      "Dumping request data for debugging...\n\n" +
      JSON.stringify(copiedArgs, null, 2) +
      "\n"
    );
    const result = await args.next();
    args.logger.debug("next() call completed");
    return result;
  });
}

// ---------------------------------------------------------------
// Start coding here..
// see https://slack.dev/bolt/

// event emoji_changed
app.event("emoji_changed", async ({ logger, event, body }) => {
  logger.debug(JSON.stringify(event, null, 2));
  //logger.debug(JSON.stringify(body, null, 2));
  if (event.type === "emoji_changed" && event.subtype === "add") {
    emoji_dict[event.name] = event.value
    logger.debug(`emoji ${event.name} is added.`);
  } else if (event.type === "emoji_changed" && event.subtype === "removed") {
    logger.debug(`emoji ${event_name} is removed`);
  } else if (event.type === "emoji_changed") {
    logger.debug(`emoji reloaded`);
    getEmojiList();
  }
});

app.command("/stamp", async ({ logger, client, ack, body }) => {
  logger.debug(JSON.stringify(body, null, 2));
  const user_id = body.user_id;
  const text = body.text;
  const team_id = body.team_id;
  const emoji = text.match(/:.+?:/gui);
  if (!emoji || emoji.length == 0) {
    ack("カスタム絵文字が見つかりませんでした。");
    return;
  }
  const e_list = emoji.map(e => e.replace(/:/g, ""));
  const blocks = generateBlocks(e_list);
  if (!blocks || blocks.length == 0) {
    ack("カスタム絵文字が見つかりませんでした。");
    return;
  }
  const user = await getUser(user_id, team_id);
  if (!user) {
    ack("この機能を利用するには、次のリンクからアプリを認可してください。\n"
      + `<${getAuthURL()}|Click here!>`);
    return;
  }
  logger.debug(blocks);
  ack();
  const result = await client.chat.postMessage({
    token: user.access_token,
    channel: body.channel_id,
    text: e_list.join(" "),
    blocks: blocks
  });
  if (!result.ok) {
    //ack("投稿に失敗しました。\n" + JSON.stringify(result, null, 2));
    logger.debug(JSON.stringify(result, null, 2));
  }
});

// echo-sd command
app.command("/echo-sd", async ({ logger, client, ack, body }) => {
  logger.debug(JSON.stringify(body, null, 2));
  const user_id = body.user_id;
  let text = body.text || "";
  const team_id = body.team_id;
  const user = await getUser(user_id, team_id);
  if (!user) {
    ack("この機能を利用するには、次のリンクからアプリを認可してください。\n"
      + `<${getAuthURL()}|Click here!>`);
    return;
  }
  try {
    ack();
    const emoji_list = text.match(/:.+?:/gui);
    if (emoji_list) {
      text = text.replace(/:.+?:/gui, "\u{15FFF}");
    }
    let sd = execSync(`echo-sd ${text}`).toString();
    if (emoji_list) {
      sd = unicode2emoji(sd, "\u{15FFF}", emoji_list);
    }
    logger.debug(sd);
    const result = await client.chat.postMessage({
      token: user.access_token,
      channel: body.channel_id,
      text: sd,
      blocks: [
        {
          "type": "section",
          "text": {
            "type": "plain_text",
            "text": sd,
            "emoji": true
          }
        }
      ]
    });
  } catch (e) {
    logger.debug(e);
  }
});
// ---------------------------------------------------------------

function unicode2emoji(text, ucode, emoji_list) {
  for (const e of emoji_list) {
    text = text.replace(ucode, e);
  }
  return text;
}

function generateBlocks(e_list) {
  let blocks = [];
  for (let e of e_list) {
    if (emoji_dict[e]) {
      blocks.push({
        type: "image",
        image_url: emoji_dict[e],
        alt_text: e
      });
    } else {
      blocks.push({
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": `:${e}:`
        }
      })
    }
  }
  return blocks;
}

async function getUser(user_id, team_id) {
  const user = await model.User.findOne({
    user_team: user_id + team_id
  }, (err, res) => {
    if (err)
      return null;
    return res;
  });
  if (!user || !user["access_token"])
    return null;
  return user;
}


function getAuthURL() {
  const scopes = "commands";
  const user_scopes = "identify,users:read,chat:write,emoji:read";
  return `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID}&scope=${scopes}&user_scope=${user_scopes}&redirect_url=${process.env.REDIRECT_URL}`;
}


// tier 2 ( 20 times / minites )
function getEmojiList() {
  request(`https://slack.com/api/emoji.list?token=${process.env.SLACK_CLIENT_TOKEN}`,
    {
      method: "GET"
    },
    (err, res, body) => {
      const b = JSON.parse(body);
      emoji_dict = b["emoji"];
      console.log("emoji.list read");
    }
  )
}



// Utility to post a message using response_url

receiver.app.set("view engine", "ejs");

function requestPromise(param) {
  return new Promise((resolve, reject) => {
    request(param, (error, response, body) => {
      if (error) {
        reject(null);
      } else {
        resolve(JSON.parse(body));
      }
    })
  });
}

receiver.app.get("/oauth", (_req, response) => {
  console.log("GET /oauth");
  const code = _req.query["code"];
  const user = {};
  Promise.resolve()
    .then(() => {
      return requestPromise(
        {
          url: "https://slack.com/api/oauth.v2.access",
          method: "POST",
          form: {
            client_id: process.env.SLACK_CLIENT_ID,
            client_secret: process.env.SLACK_CLIENT_SECRET,
            code: code,
            redirect_uri: process.env.REDIRECT_URI
          }
        })
    }).then((res) => {
      //console.log(res);
      user.access_token = res.authed_user.access_token;
      user.user_id = res.authed_user.id;
      user.scope = res.authed_user.scope;
      user.team_id = res.team.id;
      user.team = res.team.name;
      user.enterprise_id = res.enterprise.id;
      return requestPromise({
        url: "https://slack.com/api/auth.test",
        method: "POST",
        form: {
          token: user.access_token,
          user: user.user_id
        }
      });
    }).then((res) => {
      //console.log(res);
      user.url = res.url;
      return requestPromise(
        {
          url: "https://slack.com/api/users.info",
          method: "POST",
          form: {
            token: user.access_token,
            user: user.user_id
          }
        });
    }).then((res) => {
      console.log(res);
      user.real_name = res.user.real_name;
      console.log(user);
      if (user.access_token) {
        model.User.updateOne({
          user_team: user.user_id + user.team_id
        }, user, { upsert: true },
          (err) => console.log(err));
        const data = {
          message: "アクセストークンを確認しました",
          description: "「/stamp :emoji:」でカスタム絵文字を投稿することができるようになりました！！",
          link: "<p><a href=\"slack://open\">Slackへ戻る</a>"//<p><a href=\"javascript: window.open('about:blank', '_self').close();\">このページを閉じる</a></p>"
        };
        res.render("./message.ejs", data);
      } else {
        const data = {
          message: "アクセストークンを確認できませんでした。",
          description: "",
          link: "<p><a href=\"slack://open\">Slackへ戻る</a>"//<p><a href=\"javascript: window.open('about:blank', '_self').close();\">このページを閉じる</a></p>"
        };
        res.render("./message.ejs", data);
      }
    }).catch((err) => {
      console.log(err);
      const data = {
        message: "エラーが発生しました。",
        description: err,
        link: "<p><a href=\"slack://open\">Slackへ戻る</a>"//<p><a href=\"javascript: window.open('about:blank', '_self').close();\">このページを閉じる</a></p>"
      };
      res.render("./message.ejs", data);
    });
});

receiver.app.get("/:type/:file", (req, res, next) => {
  var options = {
    root: "./static/" + req.params.type,
    dotfiles: "deny",
    headers: {
      "x-timestamp": Date.now(),
      "x-sent": true
    }
  };
  var fileName = req.params.file;
  res.sendFile(fileName, options, (err) => {
    if (err) {
      console.log(err);
      res.status(err.status).end();
    }
  });
});

receiver.app.get("/status", (req, res) => {
  res.send("Your Bolt ⚡️ App is running!");
});

receiver.app.get("/", (_req, res) => {
  res.render("./index.ejs");
});

receiver.app.get("/index.html", (_req, res) => {
  res.render("./index.ejs");
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log("⚡️ Bolt app is running!");
  getEmojiList();
})();
