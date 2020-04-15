require('dotenv').config()
var express     = require("express"),
  app           = express(),
  bodyParser    = require("body-parser"),
  mongoose      = require("mongoose"),
  Campground    = require("./models/campground"),
  flash         = require("connect-flash"),
  passport      = require("passport"),
  LocalStrategy = require("passport-local"),
  methodOverride = require("method-override"),
  Comment       = require("./models/comment"),
  User          = require("./models/user"),
  seedDB         = require("./seeds")
var commentRoutes    = require("./routes/comments"),
	campgroundRoutes = require("./routes/campgrounds"),
	authRoutes       = require("./routes/index")

// mongoose.connect("mongodb://localhost/yelp_camp_v10",{useNewUrlParser: true, useUnifiedTopology: true });
mongoose.connect("mongodb+srv://PayLater:Yash@1999@cluster0-azuhu.mongodb.net/test?retryWrites=true&w=majority",{useNewUrlParser: true, useUnifiedTopology: true });

app.use(bodyParser.urlencoded({extended: true}));
app.set("view engine", "ejs");
app.use(express.static(__dirname + "/public"));
app.use(methodOverride("_method"));
app.use(flash());
// console.log(__dirname);
// seedDB(); 
// PASSPORT config
app.use(require("express-session")({
	secret: "this is secret",
	resave: false,
	saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use(function(req, res, next){
  res.locals.currentUser = req.user;
  res.locals.error =  req.flash("error");
  res.locals.success = req.flash("success");
	next();
});

app.use("/", authRoutes);
app.use("/campgrounds", campgroundRoutes);
app.use("/campgrounds/:id/comments", commentRoutes);
var port = process.env.PORT || 3000;
app.listen(process.env.PORT, process.env.IP, function(){
   console.log("The PayLater Server Has Started!");
});