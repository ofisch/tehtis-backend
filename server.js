require("dotenv").config(); // ladataan ympäristömuuttujat .env-tiedostosta
const express = require("express");
const Database = require("better-sqlite3");
const bodyParser = require("body-parser");
const cors = require("cors");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session); // Store sessions in SQLite

const multer = require("multer");
const path = require("path");

const fs = require("fs");

const app = express();
const db = new Database("database.db");

// määritellään CORS-asetukset
app.use(
  cors({
    origin: process.env.ORIGIN, // annetaan frontendin osoite yhdistämistä varten
    credentials: true, // sallitaan evästeiden käyttö
  })
);

app.use(bodyParser.json());

// käytetään SQLiteStorea sessioiden tallentamiseen
app.use(
  session({
    store: new SQLiteStore({ db: "sessions.db", dir: "./" }),
    secret: "asfkasf13t90",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // vaihdetaan TRUE, jos HTTPS
      httpOnly: true,
      sameSite: "lax", // perehdy TÄHÄN
      maxAge: 5 * 60 * 60 * 1000, // 5 tuntia, kunnes sessio vanhenee
    },
  })
);

// Ensure the "uploads" folder exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// storage engine tiedostoille
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "uploads");
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const originalName = file.originalname.replace(/\s+/g, "_"); // Replace spaces with underscores
    const extension = path.extname(originalName); // Extract file extension
    const baseName = path.basename(originalName, extension); // Remove extension from original name
    const uniqueSuffix = Date.now(); // Unique number to prevent overwriting

    cb(null, `${baseName}_${uniqueSuffix}${extension}`);
  },
});

// alustetaan multer
const upload = multer({ storage });

// luodaan taulu käyttäjille
db.prepare(
  "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, role TEXT, firstname TEXT, lastname TEXT, email TEXT, password TEXT)"
).run();

// luodaan taulu kursseille
db.prepare(
  "CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY, name TEXT, description TEXT, ownerId INTEGER, FOREIGN KEY(ownerId) REFERENCES users(id) ON DELETE CASCADE)"
).run();

// luodaan taulu tehtäville
// Create assignments table
db.prepare(
  `CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY, 
    title TEXT, 
    description TEXT, 
    courseId INTEGER, 
    FOREIGN KEY(courseId) REFERENCES courses(id) ON DELETE CASCADE
  )`
).run();

// luodaan taulu osallistujille
db.prepare(
  `CREATE TABLE IF NOT EXISTS course_members (
    courseId INTEGER,
    userId INTEGER,
    FOREIGN KEY(courseId) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (courseId, userId)
  )`
).run();

// luodaan taulu tiedostoille
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY, 
    filename TEXT, 
    path TEXT, 
    uploadedBy INTEGER, 
    courseId INTEGER NULL,
    assignmentId INTEGER NULL,
    FOREIGN KEY(uploadedBy) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(courseId) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY(assignmentId) REFERENCES assignments(id) ON DELETE CASCADE
  )
`
).run();

// luodaan taulu tehtäväpalautuksille
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY, 
    description TEXT,
    state TEXT,
    studentId INTEGER,
    firstname TEXT,
    lastname TEXT,
    assignmentId INTEGER,
    FOREIGN KEY(assignmentId) REFERENCES assignments(id) ON DELETE CASCADE
  )
`
).run();

// luodaan taulu tehtäväpalautusten tiedostoille
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS submission_files (
    id INTEGER PRIMARY KEY, 
    filename TEXT, 
    path TEXT, 
    uploadedBy INTEGER, 
    submissionId INTEGER,
    FOREIGN KEY(uploadedBy) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(submissionId) REFERENCES submissions(id) ON DELETE CASCADE
  )
`
).run();

// lisätään uusi tehtäväpalautus
app.post("/submit-assignment", upload.none(), (req, res) => {
  const { assignmentId, description, firstname, lastname, studentId } =
    req.body;

  console.log({
    assignmentId,
    description,
    firstname,
    lastname,
    studentId,
  });

  const result = db
    .prepare(
      `
    INSERT INTO submissions (description, state, firstname, lastname, studentId, assignmentId)
    VALUES (?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      description,
      "submitted",
      firstname,
      lastname,
      studentId,
      assignmentId
    );

  res.json({
    message: "Submission added",
    submissionId: result.lastInsertRowid,
  });
});

// muokataan olemassa olevaa tehtäväpalautusta
app.post("/update-submission/:id", (req, res) => {
  const { id } = req.params;
  const { description } = req.body;

  const result = db
    .prepare("UPDATE submissions SET description = ? WHERE id = ?")
    .run(description, id);

  res.json({ success: result.changes > 0 });
});

// poistetaan tehtäväpalautus
app.delete("/delete-submission/:id", (req, res) => {
  const { id } = req.params;

  // poistetaan palautuksen tiedostot
  db.prepare("DELETE FROM submission_files WHERE submissionId = ?").run(id);

  // poistetaan palautus
  const result = db.prepare("DELETE FROM submissions WHERE id = ?").run(id);

  res.json({ success: result.changes > 0 });
});

// poistetaan kaikki tehtäväpalautukset tietyltä oppilaalta tietyllä kurssilla
app.delete("/delete-submissions/:studentId/:assignmentId", (req, res) => {
  const { studentId, assignmentId } = req.params;

  // poistetaan palautukset
  const result = db
    .prepare("DELETE FROM submissions WHERE studentId = ? AND assignmentId = ?")
    .run(studentId, assignmentId);

  res.json({ success: result.changes > 0 });
});

// haetaan tehtävän palautukset
app.get("/submissions/:assignmentId", (req, res) => {
  const { assignmentId } = req.params;
  const submissions = db
    .prepare("SELECT * FROM submissions WHERE assignmentId = ?")
    .all(assignmentId);

  res.json(submissions);
});

// lisätään tiedosto tehtäväpalautukselle
app.post(
  "/upload/submission/:submissionId",
  upload.single("file"),
  (req, res) => {
    const { submissionId } = req.params;
    const userId = req.session.userId; // Ensure user is logged in

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filename = req.file.filename;
    const filepath = `uploads/${filename}`;

    db.prepare(
      "INSERT INTO submission_files (filename, path, uploadedBy, submissionId) VALUES (?, ?, ?, ?)"
    ).run(filename, filepath, userId, submissionId);

    res.json({ message: "File uploaded successfully", filepath });
  }
);

// poistetaan tiedosto tehtäväpalautuksesta
app.delete("/delete-submission-file/:fileId", (req, res) => {
  const { fileId } = req.params;
  const file = db
    .prepare("SELECT * FROM submission_files WHERE id = ?")
    .get(fileId);

  if (!file) {
    return res.status(404).json({ error: "File not found" });
  }

  fs.unlink(file.path, (err) => {
    if (err) {
      return res.status(500).json({ error: "Failed to delete file" });
    }

    db.prepare("DELETE FROM submission_files WHERE id = ?").run(fileId);
    res.json({ message: "File deleted successfully" });
  });
});

// haetaan tehtäväpalautuksen tiedostot
app.get("/files/submission/:submissionId", (req, res) => {
  const { submissionId } = req.params;
  const files = db
    .prepare("SELECT * FROM submission_files WHERE submissionId = ?")
    .all(submissionId);

  res.json(files);
});

// päivitetään palautuksen tilaa
app.post("/update-submission-state/:id", (req, res) => {
  const { id } = req.params;
  const { state } = req.body;

  const result = db
    .prepare("UPDATE submissions SET state = ? WHERE id = ?")
    .run(state, id);

  res.json({ success: result.changes > 0 });
});

// luodaan testikäyttäjä, jos sitä ei ole olemassa
const testUser = db
  .prepare("SELECT * FROM users WHERE email = ?")
  .get("matti@posti");
if (!testUser) {
  db.prepare(
    "INSERT INTO users (role, firstname, lastname, email, password) VALUES (?, ?, ?, ?, ?)"
  ).run("teacher", "matti", "meikäläinen", "matti@posti", "matti");
}

// luodaan admin-käyttäjä, jos sitä ei ole olemassa
const adminUser = db
  .prepare("SELECT * FROM users WHERE email = ?")
  .get("admin");
if (!adminUser) {
  db.prepare(
    "INSERT INTO users (role, firstname, lastname, email, password) VALUES (?, ?, ?, ?, ?)"
  ).run("admin", "admin", "admin", "admin", "admin");
}

let courseId;

// luodaan testikurssi
const testCourse = db
  .prepare("SELECT * FROM courses WHERE name = ?")
  .get("Testikurssi");

if (!testCourse) {
  // Insert the course and get the last inserted ID
  const result = db
    .prepare(
      "INSERT INTO courses (name, description, ownerId) VALUES (?, ?, ?)"
    )
    .run("Testikurssi", "Tämä on testikurssi", 1);
  courseId = result.lastInsertRowid;
} else {
  courseId = testCourse.id; // If it exists, use its actual ID
}

// liitetään testikäyttäjä testikurssille
const testEnrollment = db
  .prepare("SELECT * FROM course_members WHERE courseId = ? AND userId = ?")
  .get(courseId, 1);

if (!testEnrollment) {
  db.prepare("INSERT INTO course_members (courseId, userId) VALUES (?, ?)").run(
    courseId,
    1
  );
}

// luodaan uusi kurssi ja lisätään omistaja kurssin jäseneksi
app.post("/add-course", (req, res) => {
  const { name, description, ownerId } = req.body;

  const result = db
    .prepare(
      "INSERT INTO courses (name, description, ownerId) VALUES (?, ?, ?)"
    )
    .run(name, description, ownerId);

  // lisätään omistaja kurssin jäseneksi
  db.prepare("INSERT INTO course_members (courseId, userId) VALUES (?, ?)").run(
    result.lastInsertRowid,
    ownerId
  );

  console.log("New course ID:", result.lastInsertRowid);

  res.json({ success: result.changes > 0 });
});

// poistetaan kurssi ja kaikki sen osallistujat
app.delete("/delete-course/:id", (req, res) => {
  const { id } = req.params;

  // poistetaan osallistujat kurssilta
  db.prepare("DELETE FROM course_members WHERE courseId = ?").run(id);

  // poistetaan kurssi
  const result = db.prepare("DELETE FROM courses WHERE id = ?").run(id);

  res.json({ success: result.changes > 0 });
});

// luodaan testitehtävät
const testAssignment = db
  .prepare("SELECT * FROM assignments WHERE title = ?")
  .get("Testitehtävä");

if (!testAssignment) {
  db.prepare(
    "INSERT INTO assignments (title, description, courseId) VALUES (?, ?, ?)"
  ).run("Testitehtävä", "Tämä on testitehtävä", courseId); // Use the correct course ID
}

// päivitetään kurssin tiedot
app.post("/update-course/:id", (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  const result = db
    .prepare("UPDATE courses SET name = ?, description = ? WHERE id = ?")
    .run(name, description, id);

  res.json({ success: result.changes > 0 });
});

// ladataan tiedosto kurssille
app.post("/upload/course/:courseId", upload.single("file"), (req, res) => {
  const { courseId } = req.params;
  const userId = req.session.userId; // Ensure user is logged in

  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const filename = req.file.filename;
  const filepath = `uploads/${filename}`;

  db.prepare(
    "INSERT INTO files (filename, path, uploadedBy, courseId) VALUES (?, ?, ?, ?)"
  ).run(filename, filepath, userId, courseId);

  res.json({ message: "File uploaded successfully", filepath });
});

// poistetaan kurssin tiedostot
app.delete("/delete-file/:fileId", (req, res) => {
  const { fileId } = req.params;
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(fileId);

  if (!file) {
    return res.status(404).json({ error: "File not found" });
  }

  fs.unlink(file.path, (err) => {
    if (err) {
      return res.status(500).json({ error: "Failed to delete file" });
    }

    db.prepare("DELETE FROM files WHERE id = ?").run(fileId);
    res.json({ message: "File deleted successfully" });
  });
});

// haetaan kurssin tiedostot
app.get("/files/course/:courseId", (req, res) => {
  const { courseId } = req.params;
  const files = db
    .prepare("SELECT * FROM files WHERE courseId = ?")
    .all(courseId);

  res.json(files);
});

// haetaan kurssin tehtävät
app.get("/course-assignments/:courseId", (req, res) => {
  const { courseId } = req.params;

  const assignments = db
    .prepare("SELECT * FROM assignments WHERE courseId = ?")
    .all(courseId);

  res.json(assignments);
});

// luodaan uusi tehtävä
app.post("/add-assignment", (req, res) => {
  const { title, description, courseId } = req.body;

  const result = db
    .prepare(
      "INSERT INTO assignments (title, description, courseId) VALUES (?, ?, ?)"
    )
    .run(title, description, courseId);

  res.json({ success: result.changes > 0 });
});

// poistetaan tehtävä
app.delete("/delete-assignment/:id", (req, res) => {
  const { id } = req.params;

  // poistetaan tehtävän tiedostot
  db.prepare("DELETE FROM files WHERE assignmentId = ?").run(id);

  // poistetaan tehtävä
  const result = db.prepare("DELETE FROM assignments WHERE id = ?").run(id);

  res.json({ success: result.changes > 0 });
});

// ladataan tiedosto tehtävään
app.post(
  "/upload/assignment/:assignmentId",
  upload.single("file"),
  (req, res) => {
    const { assignmentId } = req.params;
    const userId = req.session.userId; // Ensure user is logged in

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filename = req.file.filename;
    const filepath = `uploads/${filename}`;

    db.prepare(
      "INSERT INTO files (filename, path, uploadedBy, assignmentId) VALUES (?, ?, ?, ?)"
    ).run(filename, filepath, userId, assignmentId);

    res.json({ message: "File uploaded successfully", filepath });
  }
);

// haetaan tehtävät tiedostot
app.get("/files/assignment/:assignmentId", (req, res) => {
  const { assignmentId } = req.params;
  const files = db
    .prepare("SELECT * FROM files WHERE assignmentId = ?")
    .all(assignmentId);

  res.json(files);
});

// poistetaan tehtävän tiedosto
app.delete("/delete-file/:fileId", (req, res) => {
  const { fileId } = req.params;
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(fileId);

  if (!file) {
    return res.status(404).json({ error: "File not found" });
  }

  fs.unlink(file.path, (err) => {
    if (err) {
      return res.status(500).json({ error: "Failed to delete file" });
    }

    db.prepare("DELETE FROM files WHERE id = ?").run(fileId);
    res.json({ message: "File deleted successfully" });
  });
});

// haetaan yksittäinen kurssi
app.get("/course-info/:id", (req, res) => {
  const { id } = req.params;
  const row = db.prepare("SELECT * FROM courses WHERE id = ?").get(id);
  res.json(row);
});

// haetaan kurssin osallistujat
app.get("/course-members/:id", (req, res) => {
  const { id } = req.params;
  const rows = db
    .prepare(
      "SELECT users.id, users.firstname, users.lastname, users.email FROM users JOIN course_members ON users.id = course_members.userId WHERE course_members.courseId = ?"
    )
    .all(id);
  res.json(rows);
});

// haetaan käyttäjiä hakusanalla
app.get("/search-users/:user", (req, res) => {
  const { user } = req.params; // Fix destructuring
  const searchQuery = `%${user}%`; // Add wildcard % for LIKE query

  const rows = db
    .prepare("SELECT * FROM users WHERE firstname LIKE ? OR lastname LIKE ?")
    .all(searchQuery, searchQuery);

  res.json(rows);
});

// käyttäjä liittyy kurssille
app.post("/join-course", (req, res) => {
  const { courseId } = req.body;
  const { userId } = req.session;

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  try {
    const stmt = db.prepare(
      "INSERT INTO course_members (courseId, userId) VALUES (?, ?)"
    );
    const info = stmt.run(courseId, userId);
    res.json({ message: "Joined course successfully", info });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to join course", details: error.message });
  }
});

// ADMIN / JÄRJESTELMÄNVALVOJA

// vaihdetaan käyttäjän rooli
app.post("/update-role/:userid", (req, res) => {
  const { role } = req.body; // Get only the role from body
  const userId = req.params.userid; // Get userId from URL param

  const result = db
    .prepare("UPDATE users SET role = ? WHERE id = ?")
    .run(role, userId);

  res.json({ success: result.changes > 0 });
});

// vaihdetaan käyttäjän salasana
app.post("/update-password/:userid", (req, res) => {
  const { password } = req.body; // Get only the password from body
  const userId = req.params.userid; // Get userId from URL param

  const result = db
    .prepare("UPDATE users SET password = ? WHERE id = ?")
    .run(password, userId);

  res.json({ success: result.changes > 0 });
});

// OPETTAJA

// opettaja liittää käyttäjän tai käyttäjiä kurssille
app.post("/add-member-to-course", (req, res) => {
  const { courseId, userIds } = req.body; // Expecting an array of userIds

  try {
    const insertStmt = db.prepare(
      "INSERT INTO course_members (courseId, userId) VALUES (?, ?)"
    );

    const insertMany = db.transaction((userIds) => {
      userIds.forEach((userId) => {
        insertStmt.run(courseId, userId);
      });
    });

    insertMany(userIds);

    res.json({ message: "Added members to course successfully" });
  } catch (error) {
    res.status(500).json({
      error: "Failed to add members to course",
      details: error.message,
    });
  }
});

// opettaja poistaa käyttäjän tai käyttäjiä kurssilta
app.post("/remove-member-from-course", (req, res) => {
  const { courseId, userIds } = req.body; // Expecting an array of userIds

  try {
    const deleteStmt = db.prepare(
      "DELETE FROM course_members WHERE courseId = ? AND userId = ?"
    );

    const deleteMany = db.transaction((userIds) => {
      userIds.forEach((userId) => {
        deleteStmt.run(courseId, userId);
      });
    });

    deleteMany(userIds);

    res.json({ message: "Removed members from course successfully" });
  } catch (error) {
    res.status(500).json({
      error: "Failed to remove members from course",
      details: error.message,
    });
  }
});

// haetaan kurssit, joihin käyttäjä osallistuu
app.get("/my-courses", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  const rows = db
    .prepare(
      "SELECT courses.id, courses.name, courses.description FROM courses JOIN course_members ON courses.id = course_members.courseId WHERE course_members.userId = ?"
    )
    .all(req.session.userId);

  res.json(rows);
});

// haetaan kurssin osallistujat
app.get("/course/:id/members", (req, res) => {
  const { id } = req.params;
  const rows = db
    .prepare(
      "SELECT users.id, users.firstname, users.lastname users.email FROM users JOIN course_members ON users.id = course_members.userId WHERE course_members.courseId = ?"
    )
    .all(id);
  res.json(rows);
});

// käyttäjän lisääminen
app.post("/add", (req, res) => {
  const { name, email, password } = req.body;
  const stmt = db.prepare(
    "INSERT INTO users (firstname, lastname, email, password) VALUES (?, ?, ?)"
  );
  const info = stmt.run(firstname, lastname, email, password);
  res.json(info);
});

// KIRJAUTUMINEN

// sisäänkirjautuminen
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // säilötään sessioon käyttäjän id ja sähköposti
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.firstname = user.firstname;
  req.session.lastname = user.lastname;
  req.session.email = user.email;

  console.log("Session stored:", req.session);
  return res.json({ message: "Login successful", userId: user.id });
});

//rekisteröityminen
app.post("/register", (req, res) => {
  const { firstname, lastname, email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  // jos sähköposti on jo käytössä, palautetaan virhe
  if (user) {
    return res.status(409).json({ error: "User already exists" });
  }

  // lisätään uusi käyttäjä tietokantaan
  const stmt = db.prepare(
    "INSERT INTO users (role, firstname, lastname, email, password) VALUES (?, ?, ?, ?, ?)"
  );
  const info = stmt.run("student", firstname, lastname, email, password);
  res.json(info);
});

// varmistetaan session olemassaolo
app.get("/session", (req, res) => {
  if (req.session.userId) {
    return res.json({
      loggedIn: true,
      userId: req.session.userId,
      role: req.session.role,
      email: req.session.email,
      firstname: req.session.firstname,
      lastname: req.session.lastname,
    });
  } else {
    return res.json({ loggedIn: false });
  }
});

// uloskirjautuminen
app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }
    res.clearCookie("connect.sid"); // poistetaan eväste
    res.json({ message: "Logged out successfully" });
  });
});

// haetaan kaikki käyttäjät
app.get("/users", (req, res) => {
  const rows = db.prepare("SELECT * FROM users").all();
  console.log("All users:", rows);
  res.json(rows);
});

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.listen(process.env.PORT, () => {
  console.log("Server is running on port: " + process.env.PORT);
  console.log("address: " + process.env.ORIGIN);
});
