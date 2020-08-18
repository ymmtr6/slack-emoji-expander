const mongoose = require("mongoose")
const userSchema = new mongoose.Schema({
  user_team: { type: String, require: true, unique: true},
  user_id: { type: String, require: true },
  team_id: { type: String, require: true },
  access_token: String,
  enterprise_id: String,
  scope: String,
  url: String,
  team: String,
  user: String,
  real_name: String,
  preMessage: String
});

exports.User = mongoose.model("User", userSchema);
