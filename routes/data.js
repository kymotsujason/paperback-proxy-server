const express = require("express");
const fs = require("fs");
const path = require("path");
const rootDirectory = process.cwd();
var router = express.Router();

/* GET home page. */
router.get("/:chapterId/:imageName", (req, res) => {
	const chapterId = req.params.chapterId;
	const imageName = req.params.imageName;
	const imagePath = path.join(
		__dirname.replace("routes", ""),
		"data",
		chapterId,
		imageName
	);
	console.log(imagePath);

	// Check if the file exists
	fs.access(imagePath, fs.constants.F_OK, (err) => {
		if (err) {
			// Image doesn't exist
			res.status(404).send("Image not found");
		} else {
			// Read the image into a buffer
			fs.readFile(imagePath, (err, data) => {
				if (err) {
					res.status(500).send("Error reading the image");
				} else {
					// Determine the content type based on the file extension
					const extension = path.extname(imageName).toLowerCase();
					let contentType = "image/jpeg"; // Default content type

					if (extension === ".png") {
						contentType = "image/png";
					} else if (extension === ".gif") {
						contentType = "image/gif";
					} else if (extension === ".bmp") {
						contentType = "image/bmp";
					} else if (extension === ".svg") {
						contentType = "image/svg+xml";
					}

					// Set the content type and send the image data
					res.setHeader("Content-Type", contentType);
					res.send(data);
				}
			});
		}
	});
});

module.exports = router;
