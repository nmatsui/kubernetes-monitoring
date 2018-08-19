'use strict'

const app = require("express")();
const log4js = require('log4js');
const logger = log4js.getLogger('app');
logger.level = "debug";

app.get("/error", (req, res, next) => {
    throw new Error("error!!");
});

app.get("*", (req, res, next) => {
    logger.debug("request path: " + req.url);
    res.json({result: "success"});
});

app.use((err, req, res, next) => {
    logger.error(String(err));
    res.status(500).send({result: String(err)});
});

app.listen(3030, () => {
    logger.info("Server running on port 3030");
});
