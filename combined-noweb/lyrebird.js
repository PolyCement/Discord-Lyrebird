"use strict";

const GENERATE_API = "https://avatar.lyrebird.ai/api/v0/generate";
const TOKEN_API = "https://avatar.lyrebird.ai/api/v0/token";
const AUTH_API = "https://myvoice.lyrebird.ai/authorize";

const logger = require("heroku-logger");

logger.info("LOADING LIBRARIES...");

const Discord = require("discord.js");
const client = new Discord.Client();

const request = require("request");
const crypto = require("crypto");
const fs = require("fs");

const prefix = "lyre_";

let voices = {};
if (fs.existsSync("voices.json")) {
    voices = JSON.parse(fs.readFileSync("voices.json", "utf8"));
}

let pending = {};

client.login(process.env.DISCORD_BOT_TOKEN).catch(logger.error);

client.on("ready", function() {
    client.user.setActivity("with your voice").catch(logger.error);
    logger.info("BOT READY FOR ACTION!");
});

client.on("message", function(message) {
    if (message.author.bot) return;
    // we can't lowercase here cos the auth codes are case-sensitive
    const content = message.content; //.toLowerCase();
    // gonna just cram this in the front for now while i prove to myself that this will work
    if (content.split(" ")[0] === prefix + "settoken") {
        // the user should've given us a url which has the code and state in it, strip em outta there
        // ps. this regex sucks but im just goofin
        console.log(content);
        let match = content.match(/.*\?code=([^&]*)&state=(.*)/);
        if (match !== null) {
            let code = match[1];
            let state = match[2];
            // the rest of this is more or less just what the combined web version runs when it gets a request
            request.post({
                url: TOKEN_API,
                json: true,
                body: {
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": process.env.LYRE_CLIENT_ID,
                    "client_secret": process.env.LYRE_CLIENT_SECRET
                }
            }, function(error, response, body) {
                if (error) {
                    message.author.send(error);
                    logger.error(error);
                } else {
                    const message = pending[state];
                    if (message) {
                        const id = (message.guild || message.channel).id;
                        voices[id] = voices[id] || [];
                        voices[id].push(body);
                        message.author.send("Thanks. Type `" + prefix + "voice" + voices[id].length + "` to use your voice!");
                        message.channel.send("`" + prefix + "voice" + voices[id].length + "` was added by " + message.author.tag + "!").catch(logger.error);
                        const json = JSON.stringify(voices);
                        fs.writeFileSync("voices.json", json);
                        logger.debug(json);
                        delete pending[state];
                    } else {
                        message.author.send("Authentication expired. Try running `" + prefix + "addvoice` again.");
                    }
                }
            });
        }
    } else if (content === prefix + "addvoice") {
        const secret = crypto.randomBytes(48).toString("hex");
        const rich = new Discord.MessageEmbed();
        rich.setTitle("Add your voice");
        rich.setDescription("[Click here to add your Lyrebird voice](" + AUTH_API + "?response_type=code&client_id=" + process.env.LYRE_CLIENT_ID + "&redirect_uri=" + encodeURIComponent(process.env.LYRE_REDIRECT_URI) + "&scope=voice&state=" + secret + ")");
        rich.setColor(0x1d52d6);
        message.author.send(rich).catch(logger.error);
        pending[secret] = message;
    } else if (content === prefix + "join") {
        if (message.member.voice && message.member.voice.channel) {
            message.member.voice.channel.join().catch(function() {
                message.channel.send("Missing permission to join voice channels!").catch(logger.error);
            });
        } else {
            message.channel.send("Join a voice channel first!").catch(logger.error);
        }
    } else if (content === prefix + "leave") {
        const connection = message.guild.voice && message.guild.voice.connection;
        if (connection) {
            connection.disconnect();
        }
    } else {
        const id = (message.guild || message.channel).id;
        if (voices[id]) {
            for (let i = 0; i < voices[id].length; i++) {
                const command = prefix + "voice" + (i + 1);
                if (content.split(" ")[0] === command) {
                    const utterance = message.content.slice(command.length).trim();
                    if (utterance) {
                        logger.debug("Playing " + utterance + "!");
                        const fileName = crypto.randomBytes(48).toString("hex") + ".wav";
                        request.post({
                            url: GENERATE_API,
                            headers: {
                                "Authorization": "Bearer " + voices[id][i].access_token
                            },
                            json: true,
                            body: {
                                text: utterance
                            }
                        }, function(error, response) {
                            if (error) {
                                logger.error(error);
                                fs.unlinkSync(fileName);
                            } else if (response.statusCode !== 200) {
                                message.channel.send(response.body.description).catch(logger.error);
                                fs.unlinkSync(fileName);
                            } else if (message.guild && message.guild.voice && message.guild.voice.connection) {
                                message.guild.voice.connection.play(fileName).on("finish", function() {
                                    fs.unlinkSync(fileName);
                                });
                            } else {
                                message.channel.send({
                                    files: [{
                                        attachment: fileName,
                                        name: utterance.replace(/[^a-z0-9]/gi, "_") + ".wav"
                                    }]
                                }).then(function() {
                                    fs.unlinkSync(fileName);
                                }).catch(logger.error);
                            }
                        }).pipe(fs.createWriteStream(fileName));
                    } else {
                        message.channel.send("No text specified!").catch(logger.error);
                    }
                }
            }
        }
    }
});
