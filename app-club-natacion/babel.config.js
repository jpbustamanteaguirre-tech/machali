// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'expo-router/babel',
      // otros plugins que uses...
      'react-native-reanimated/plugin', // <-- siempre el último
    ],
  };
};
