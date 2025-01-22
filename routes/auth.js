// routes/auth.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

// Login route
router.post("/login", async (req, res) => {
	let username = "",
		password = "";
	if (req.body.username) {
		username = req.body.username;
		password = req.body.password;
	} else {
		req.query;
		username = req.query.username;
		password = req.query.password;
	}

	// Find user
	const user = process.env.USER === username;
	if (!user) {
		return res.status(401).send("Invalid username or password");
	}

	// Check password
	const isPasswordValid = await bcrypt.compare(process.env.PASS, password);
	if (!isPasswordValid) {
		return res.status(401).send("Invalid username or password");
	}

	// Generate JWT
	const token = jwt.sign(
		{
			id: 1,
			username: process.env.USER,
		},
		process.env.KEY,
		{ expiresIn: "8640h" } // Token expires in 1 year
	);

	// Send token to client
	res.json({ token });
});

module.exports = router;
