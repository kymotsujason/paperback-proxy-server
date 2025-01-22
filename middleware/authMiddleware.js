// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");

function authenticateToken(req, res, next) {
	// Get token from the header
	const authHeader = req.headers["authorization"];
	const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

	if (!token) return res.status(401).send("Access Token Required");

	jwt.verify(token, process.env.KEY, (err, user) => {
		if (err) return res.status(403).send("Invalid Access Token");
		req.user = user; // Add the user payload to the request object
		next();
	});
}

module.exports = authenticateToken;
