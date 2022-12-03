require("dotenv").config();
const express = require("express");
const nunjucks = require("nunjucks");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const { nanoid } = require("nanoid");
const { MongoClient, ObjectId } = require("mongodb");
const { response } = require("express");

const app = express();

const clientPromise = MongoClient.connect(process.env.DB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

app.use(async (req, res, next) => {
  try {
    const client = await clientPromise;
    req.db = client.db("users");
    next();
  } catch (err) {
    next(err);
  }
})

nunjucks.configure("views", {
  autoescape: true,
  express: app,
  tags: {
    blockStart: "[%",
    blockEnd: "%]",
    variableStart: "[[",
    variableEnd: "]]",
    commentStart: "[#",
    commentEnd: "#]",
  },

});

app.set("view engine", "njk");

app.use(cookieParser());


const auth = () => async (req, res, next) => {
  if(!req.cookies["sessionId"]) {
    return next();
  }
  const user = await findUserBySessionId(req.db, req.cookies['sessionId']);
  req.user = user;
  req.sessionId = req.cookies['sessionId'];
  next();
}

app.use(express.json());

app.use(express.static("public"));

const findUserByUserName = async (db, username) => {
  return db.collection("users").findOne({ username });
}

const findUserBySessionId = async (db, sessionId) => {
  const session = await db.collection("sessions")
    .findOne({ sessionId }, {
      projection: { userId: 1},
    });
    if(!session) {
      return;
    }
    return await db.collection("users").findOne({_id: ObjectId(session.userId)})
}

const createSession = async (db, userId)=> {
  const sessionId = nanoid();
  await db.collection("sessions")
    .insertOne({userId, sessionId})
  return sessionId;
}

const deleteSession = async (db, sessionId) => {
  db.collection("sessions").deleteOne({ sessionId} );
}

const createUser = async (db, username, password) => {
  const user = await findUserByUserName(db, username);
  if(user) {
    return user.id
  }
  const { insertedId } = await db.collection("users")
    .insertOne({username, password});
  return insertedId.toString();
}


app.get("/", auth(), (req, res) => {
  res.render("index", {
    user: req.user,
    authError: req.query.authError === "true" ? "Wrong username or password" : req.query.authError,
  });
});

app.post("/login", bodyParser.urlencoded({extended: false}) , async (req, res) => {
  const { username, password} = req.body;
  const user = await findUserByUserName(req.db, username);
  if(!user || user.password !== password) {
    return res.redirect('/?authError=true');
  }
  const sessionId = await createSession(req.db, (user._id).toString());
  res.cookie("sessionId", sessionId, { httpOnly: true, expires: 0 }).redirect('/');
});

app.post("/signup", bodyParser.urlencoded({extended: false}) , async (req, res) => {
  const { username, password } = req.body;
  const id = await createUser(req.db, username, password);
  const sessionId = await createSession(req.db, id);
  res.cookie("sessionId", sessionId, { httpOnly: true, expires: 0 }).redirect('/');
});

app.get("/logout", auth(), async (req, res) => {
  if(!req.user) {
    return res.redirect("/");
  }
  await deleteSession(req.db, req.sessionId);
  res.clearCookie('sessionId').redirect("/");
})

const getTimers = async (db, isActive, userId) => {
  const active = true ? isActive === 'true' : false;
  return await db.collection("timers").find({isActive: active, user_id: userId}).toArray();
}

const getStartById = async (db, id) => {
  return db.collection("timers")
  .findOne({_id: ObjectId(id)}, {
    projection: { start: 1},
  })
}

const updateTimer = async (db, id, res) => {
  const start = await getStartById(db, id);
  const duration = Date.now() - start.start;
  const { modifiedCount } = db.collection("timers")
    .updateOne( {_id: ObjectId(id)}, {
      $set: {duration: duration, end: Date.now(), isActive: false}
    })
  if( modifiedCount === 0) {
    res.status(404).send(`Unknown userId ${ id }`)
  } else {
    res.status(204)
  }
}

app.get("/api/timers", auth(), async (req, res) => {
  const user_id = req.user._id.toString();
  const timers = await getTimers(req.db, req.query.isActive, user_id);
  if(timers) {
    return res.json(timers);
  } else {
    res.sendStatus(403);
  }
})

app.post("/api/timers", auth(), async (req, res) => {
  const user = await findUserBySessionId(req.db, req.cookies['sessionId']);
  if(req.body) {
    const data = req.body;
    db = req.db;
    const { insertedId } = await db.collection("timers").insertOne({
        start: Date.now(),
        end: Date.now(),
        description: data.description,
        isActive: true,
        user_id: user._id.toString(),
    })
    return res.json(JSON.stringify(insertedId));
  }
  res.sendStatus(403);
})

app.post("/api/timers/:id/stop", auth(), async (req, res) => {
  if(req.params.id) {
    const id = req.params.id;
    await updateTimer(req.db, id, res);
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`  Listening on http://localhost:${port}`);
});
