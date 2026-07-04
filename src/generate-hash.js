const bcrypt = require('bcrypt');
const password = process.argv[2] || 'admin123';

bcrypt.hash(password, 10).then(hash => {
  console.log('Mot de passe:', password);
  console.log('Hash à mettre dans .env :');
  console.log(hash);
});
 