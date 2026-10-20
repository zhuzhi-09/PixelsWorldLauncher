import '@material/web/all.js'
import { styles as typescaleStyles } from '@material/web/typography/md-typescale-styles.js'
import 'material-symbols/rounded.css'
import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { initStore } from './store'

document.adoptedStyleSheets.push(typescaleStyles.styleSheet!)

initStore().finally(() => createApp(App).mount('#app'))
