const moduleAlias = require('module-alias');
const path = require('path');

moduleAlias.addAliases({
  '@': path.join(__dirname, '..', 'dist'),
  '@modules': path.join(__dirname, '..', 'dist', 'modules'),
  '@constants': path.join(__dirname, '..', 'dist', 'constants'),
  '@types': path.join(__dirname, '..', 'dist', 'types'),
  '@utils': path.join(__dirname, '..', 'dist', 'utils'),
  '@schemas': path.join(__dirname, '..', 'dist', 'schemas'),
  '@common': path.join(__dirname, '..', 'dist', 'common'),
  '@config': path.join(__dirname, '..', 'dist', 'config'),
  '@decorators': path.join(__dirname, '..', 'dist', 'common', 'decorators'),
  '@auth-decorators': path.join(__dirname, '..', 'dist', 'modules', 'common', 'auth', 'decorators'),
  '@guards': path.join(__dirname, '..', 'dist', 'modules', 'common', 'auth', 'guards'),
  '@middleware': path.join(__dirname, '..', 'dist', 'common', 'middleware'),
  '@templates': path.join(__dirname, '..', 'dist', 'templates'),
  '@domain': path.join(__dirname, '..', 'dist', 'modules', 'domain'),
  '@inventory': path.join(__dirname, '..', 'dist', 'modules', 'inventory'),
  '@production': path.join(__dirname, '..', 'dist', 'modules', 'production'),
  '@people': path.join(__dirname, '..', 'dist', 'modules', 'people'),
  '@paint': path.join(__dirname, '..', 'dist', 'modules', 'paint'),
  '@system': path.join(__dirname, '..', 'dist', 'modules', 'system'),
  '@integrations': path.join(__dirname, '..', 'dist', 'modules', 'integrations'),
  '@human-resources': path.join(__dirname, '..', 'dist', 'modules', 'human-resources'),
});
