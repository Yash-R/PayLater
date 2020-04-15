var mongoose = require("mongoose"),
	Campground= require("./models/campground"),
	Comment   = require("./models/comment");

var data =[
	{
		name: "cloud's rest",
		image: "https://pixabay.com/get/52e3d3404a55af14f6da8c7dda793f7f1636dfe2564c704c7d2b7fd19e4ec75e_340.png",
		description: "The famous campground"
	},
	{
		name: "new clouds rest",
		image: "https://pixabay.com/get/52e3d3404a55af14f6da8c7dda793f7f1636dfe2564c704c7d2b7fd19e4ec75e_340.png",
		description: "the most famous one"
	},
	{
		name: "new",
		image: "https://pixabay.com/get/52e3d3404a55af14f6da8c7dda793f7f1636dfe2564c704c7d2b7fd19e4ec75e_340.png",
		description: "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book. It has survived not only five centuries, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised in the 1960s with the release of Letraset sheets containing Lorem Ipsum passages, and more recently with desktop publishing software like Aldus PageMaker including versions of Lorem Ipsum."
	}
]

function seedDB(){
	// Remove all campground
	Campground.remove({}, function(err){
		if(err){
			console.log(err);
		}
		// add a campground
	data.forEach(function(seed){
		Campground.create(seed, function(err, campground){
			if(err){
				console.log(err);
			} else {
				console.log("Added a campground");
				// Add a Comment
				Comment.create(
				{
					text: "This place is awesome",
					author: "colt"
				}, function(err, comment){
					if(err){
						console.log(err);
					} else {
						campground.comments.push(comment);
						campground.save();
						console.log("Created new comment");
					}
					
				});
			}
		});
	});
	
		console.log("removed campground!");
	});
	
}

module.exports = seedDB;