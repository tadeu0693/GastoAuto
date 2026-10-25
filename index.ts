import { registerRootComponent } from 'expo';
import React from 'react';
import { ScrollView, Text } from 'react-native';

// Mostra o erro na tela em vez de fechar o app
function Crash({ error }: { error: any }) {
  return React.createElement(ScrollView, { style: { flex: 1, backgroundColor: '#0E1116' }, contentContainerStyle: { padding: 24, paddingTop: 64 } },
    React.createElement(Text, { style: { color: '#FF6B6B', fontSize: 16, fontWeight: '700', marginBottom: 12 } }, 'Erro ao iniciar'),
    React.createElement(Text, { selectable: true, style: { color: '#E8ECF2', fontSize: 12 } }, String(error?.stack || error)));
}

class Boundary extends React.Component<{ children: any }, { error: any }> {
  state = { error: null as any };
  static getDerivedStateFromError(error: any) { return { error }; }
  render() { return this.state.error ? React.createElement(Crash, { error: this.state.error }) : this.props.children; }
}

let Root: any;
try {
  require('./src/background');
  const App = require('./App').default;
  Root = () => React.createElement(Boundary, null, React.createElement(App));
} catch (e) {
  Root = () => React.createElement(Crash, { error: e });
}

registerRootComponent(Root);
