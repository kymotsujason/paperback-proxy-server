require("dotenv").config();

const createError = require("http-errors");
const bodyParser = require("body-parser");
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const debug = require("debug")("backend:server");
const http = require("http");
const compression = require("compression");

const indexRouter = require("./routes/index");
const authRoute = require("./routes/auth");
const mangaRouter = require("./routes/manga");
const dataRouter = require("./routes/data");
const genericRouter = require("./routes/generic");

const app = express();
const port = normalizePort(process.env.PORT || "3000");
app.set("port", port);

const server = http.createServer(app);

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

app.use(compression());
app.use(bodyParser.json());
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
//app.use("/data", express.static(path.join(__dirname, "data")));

app.use("/", indexRouter);
app.use("/manga", mangaRouter);
app.use("/generic", genericRouter);
app.use("/api/auth", authRoute);
app.use("/data", dataRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
	next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
	// set locals, only providing error in development
	res.locals.message = err.message;
	res.locals.error = process.env.STATUS === "development" ? err : {};
	// render the error page
	res.status(err.status || 500);
	res.render("error");
});

server.listen(port);
server.on("error", onError);
server.on("listening", onListening);

function normalizePort(val) {
	const port = parseInt(val, 10);

	if (isNaN(port)) {
		return val;
	}

	if (port >= 0) {
		return port;
	}

	return false;
}
function onError(error) {
	if (error.syscall !== "listen") {
		throw error;
	}

	const bind = typeof port === "string" ? "Pipe " + port : "Port " + port;

	switch (error.code) {
		case "EACCES":
			console.error(bind + " requires elevated privileges");
			process.exit(1);
			break;
		case "EADDRINUSE":
			console.error(bind + " is already in use");
			process.exit(1);
			break;
		default:
			throw error;
	}
}

function onListening() {
	const addr = server.address();
	const bind =
		typeof addr === "string" ? "pipe " + addr : "port " + addr.port;
	debug("Listening on " + bind);
}

module.exports = app;
