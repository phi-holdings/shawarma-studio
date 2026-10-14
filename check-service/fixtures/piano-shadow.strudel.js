const mel = { major: `<[c4 e4 g4]>` }
const piano = (key) => note(mel[key]).s("piano")
stack(piano('major'))
