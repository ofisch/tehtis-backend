// Refactored server.js to use JWT instead of session cookies
require("dotenv").config();
const express = require("express");
const Database = require("better-sqlite3");
const bodyParser = require("body-parser");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");

const app = express();
const db = new Database("database.db");
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// CORS setup
app.use(
  cors({
    origin: process.env.ORIGIN,
    credentials: true,
  })
);

app.use(bodyParser.json());

// JWT auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Multer setup
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const originalName = file.originalname.replace(/\s+/g, "_");
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext);
    cb(null, `${base}_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

// Login - issue JWT
db.prepare(
  "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, role TEXT, firstname TEXT, lastname TEXT, email TEXT, password TEXT)"
).run();

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    {
      userId: user.id,
      role: user.role,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: "5h" }
  );

  res.json({ token });
});

// Example protected route
app.get("/my-courses", authenticateToken, (req, res) => {
  const rows = db
    .prepare(
      "SELECT courses.id, courses.name, courses.description FROM courses JOIN course_members ON courses.id = course_members.courseId WHERE course_members.userId = ?"
    )
    .all(req.user.userId);

  res.json(rows);
});

// Example file upload with auth
app.post(
  "/upload/course/:courseId",
  authenticateToken,
  upload.single("file"),
  (req, res) => {
    const { courseId } = req.params;
    const userId = req.user.userId;

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filename = req.file.filename;
    const filepath = `uploads/${filename}`;

    db.prepare(
      "INSERT INTO files (filename, path, uploadedBy, courseId) VALUES (?, ?, ?, ?)"
    ).run(filename, filepath, userId, courseId);

    res.json({ message: "File uploaded successfully", filepath });
  }
);

// Register user
app.post("/register", (req, res) => {
  const { firstname, lastname, email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (user) return res.status(409).json({ error: "User already exists" });

  db.prepare(
    "INSERT INTO users (role, firstname, lastname, email, password) VALUES (?, ?, ?, ?, ?)"
  ).run("student", firstname, lastname, email, password);

  res.json({ message: "User registered successfully" });
});

// Add more routes using authenticateToken for auth...

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port", process.env.PORT || 3000);
});
