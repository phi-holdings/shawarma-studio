setcpm(30)
const mel = { major: `<[c4 e4 g4]>` }
const lead = (key) => note(mel[key]).s("supersaw")
lead("major")
