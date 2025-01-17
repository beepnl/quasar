const
  fs = require('fs'),
  path = require('path')

const
  { logError, writeFile } = require('./build.utils'),
  typeRoot = path.resolve(__dirname, '../types'),
  distRoot = path.resolve(__dirname, '../dist/types'),
  resolvePath = file => path.resolve(distRoot, file),
  extraInterfaces = {},
  // eslint-disable-next-line no-useless-escape
  toCamelCase = s => s.replace(/(\-\w)/g, m => { return m[1].toUpperCase() })

function writeLine (fileContent, line = '', indent = 0) {
  fileContent.push(`${line.padStart(line.length + (indent * 4), ' ')}\n`)
}

function writeLines (fileContent, lines = '', indent = 0) {
  lines.split('\n').forEach(line => writeLine(fileContent, line, indent))
}

function write (fileContent, text = '') {
  fileContent.push(`${text}`)
}

const typeMap = new Map([
  ['Array', 'any[]'],
  ['Any', 'any'],
  ['Component', 'Vue'],
  ['String', 'string'],
  ['Boolean', 'boolean'],
  ['Number', 'number']
])

function convertTypeVal (type, def, required) {
  if (def.tsType !== void 0) {
    return def.tsType
  }

  const t = type.trim()

  if (typeMap.has(t)) {
    return typeMap.get(t)
  }

  if (t === 'Object') {
    if (def.definition) {
      const propDefinitions = getPropDefinitions(def.definition, required, true)
      let lines = []
      propDefinitions.forEach(p => lines.push(...p.split('\n')))
      return propDefinitions && propDefinitions.length > 0 ? `{\n        ${lines.join('\n        ')} }` : 'any'
    }

    return 'any'
  }

  return t
}

function getTypeVal (def, required) {
  return Array.isArray(def.type)
    ? def.type.map(type => convertTypeVal(type, def, required)).join(' | ')
    : convertTypeVal(def.type, def, required)
}

function getPropDefinition (key, propDef, required, docs = false) {
  const propName = toCamelCase(key)

  if (!propName.startsWith('...')) {
    const propType = getTypeVal(propDef, required)
    addToExtraInterfaces(propDef)
    return `${docs ? `/**\n * ${propDef.desc}\n */\n` : ''}${propName}${!propDef.required && !required ? '?' : ''} : ${propType}`
  }
}

function getPropDefinitions (propDefs, required, docs = false) {
  const defs = []

  for (const key in propDefs) {
    const def = getPropDefinition(key, propDefs[key], required, docs)
    def && defs.push(def)
  }

  return defs
}

function getMethodDefinition (key, methodDef, required) {
  let def = `/**\n * ${methodDef.desc}\n`
  if (methodDef.params) {
    def += `${Object.entries(methodDef.params).map(([name, paramDef]) => ` * @param ${name} ${paramDef.desc}`).join('\n')}\n`
  }

  const returns = methodDef.returns
  if (returns) {
    def += ` * @returns ${returns.desc}\n`
  }

  def += ` */\n${key} (`

  if (methodDef.params) {
    // TODO: Verify if this should be optional even for plugins
    const params = getPropDefinitions(methodDef.params, false, false)
    def += params.join(', ')
  }

  def += `): ${returns ? getTypeVal(returns, required) : 'void'}`

  return def
}

function getObjectParamDefinition (def, required) {
  let res = []

  Object.keys(def).forEach(propName => {
    const propDef = def[propName]
    if (propDef.type && propDef.type === 'Function') {
      res.push(
        getMethodDefinition(propName, propDef, required)
      )
    }
    else {
      res.push(
        getPropDefinition(propName, propDef, required, true)
      )
    }
  })

  return res
}

function getInjectionDefinition (injectionName, typeDef) {
  // Get property injection point
  for (var propKey in typeDef.props) {
    const propDef = typeDef.props[propKey]
    if (propDef.tsInjectionPoint) {
      return getPropDefinition(injectionName, propDef, true, true)
    }
  }

  // Get method injection point
  for (var methodKey in typeDef.methods) {
    const methodDef = typeDef.methods[methodKey]
    if (methodDef.tsInjectionPoint) {
      return getMethodDefinition(injectionName, methodDef, true)
    }
  }
}

function copyPredefinedTypes (dir, parentDir) {
  fs.readdirSync(dir).forEach(file => {
    const fullPath = path.resolve(dir, file)
    const stats = fs.lstatSync(fullPath)
    if (stats.isFile()) {
      writeFile(
        resolvePath(parentDir ? parentDir + file : file),
        fs.readFileSync(fullPath)
      )
    }
    else if (stats.isDirectory()) {
      const p = resolvePath(parentDir ? parentDir + file : file)
      if (!fs.existsSync(p)) {
        fs.mkdirSync(p)
      }
      copyPredefinedTypes(fullPath, parentDir ? parentDir + file : file + '/')
    }
  })
}

function addToExtraInterfaces (def, required) {
  if (
    def !== void 0 &&
    def.tsType !== void 0 &&
    extraInterfaces[def.tsType] === void 0 &&
    def.definition !== void 0
  ) {
    extraInterfaces[def.tsType] = getObjectParamDefinition(
      def.definition, required
    )
  }
}

function writeQuasarPluginProps (contents, nameName, props, isLast) {
  writeLine(contents, `${nameName}: {`, 1)
  props.forEach(prop => writeLines(contents, prop, 2))
  writeLine(contents, `}${isLast ? '' : ','}`, 1)
}

function addQuasarPluginOptions (contents, components, directives, plugins) {
  writeLine(contents, `import { QuasarIconSet } from './extras'`)
  writeLine(contents, `import { QuasarLanguage } from './lang'`)
  writeLine(contents, `export interface QuasarPluginOptions {`)
  writeLine(contents, `lang: QuasarLanguage,`, 1)
  writeLine(contents, `config: any,`, 1)
  writeLine(contents, `iconSet: QuasarIconSet,`, 1)
  writeQuasarPluginProps(contents, 'components', components)
  writeQuasarPluginProps(contents, 'directives', directives)
  writeQuasarPluginProps(contents, 'plugins', plugins, true)
  writeLine(contents, `}`)
  writeLine(contents)
}

function writeIndexDTS (apis) {
  var contents = []
  var quasarTypeContents = []
  var components = []
  var directives = []
  var plugins = []

  writeLine(contents, `import Vue, { VueConstructor, PluginObject } from 'vue'`)
  writeLine(contents)
  writeLine(quasarTypeContents, 'export as namespace quasar')
  writeLine(quasarTypeContents, `export * from './utils'`)
  writeLine(quasarTypeContents, `export * from './globals'`)
  writeLine(quasarTypeContents, `export * from './boot'`)
  writeLine(quasarTypeContents, `export * from './extras'`)
  writeLine(quasarTypeContents, `export * from './lang'`)

  const injections = {}

  apis.forEach(data => {
    const content = data.api
    const typeName = data.name

    const extendsVue = (content.type === 'component' || content.type === 'mixin')
    const typeValue = `${extendsVue ? `VueConstructor<${typeName}>` : typeName}`
    // Add Type to the appropriate section of types
    const propTypeDef = `${typeName}?: ${typeValue}`
    if (content.type === 'component') {
      write(components, propTypeDef)
    }
    else if (content.type === 'directive') {
      write(directives, propTypeDef)
    }
    else if (content.type === 'plugin') {
      write(plugins, propTypeDef)
    }

    // Declare class
    writeLine(quasarTypeContents, `export const ${typeName}: ${extendsVue ? `VueConstructor<${typeName}>` : typeName}`)
    writeLine(contents, `export interface ${typeName} ${extendsVue ? 'extends Vue ' : ''}{`)

    // Write Props
    const props = getPropDefinitions(content.props, content.type === 'plugin', true)
    props.forEach(prop => writeLines(contents, prop, 1))

    // Write Methods
    for (const methodKey in content.methods) {
      const method = content.methods[methodKey]
      const methodDefinition = getMethodDefinition(methodKey, method, content.type === 'plugin')
      writeLines(contents, methodDefinition, 1)
      addToExtraInterfaces(method.returns, true)
    }

    // Close class declaration
    writeLine(contents, `}`)
    writeLine(contents)

    // Copy Injections for type declaration
    if (content.type === 'plugin') {
      if (content.injection) {
        const injectionParts = content.injection.split('.')
        if (!injections[injectionParts[0]]) {
          injections[injectionParts[0]] = []
        }
        let def = getInjectionDefinition(injectionParts[1], content)
        if (!def) {
          def = `${injectionParts[1]}: ${typeName}`
        }
        injections[injectionParts[0]].push(def)
      }
    }
  })

  Object.keys(extraInterfaces).forEach(name => {
    writeLine(contents, `export interface ${name} {`)
    extraInterfaces[name].forEach(def => {
      writeLines(contents, def, 1)
    })
    writeLine(contents, `}\n`)
  })

  // Write injection types
  for (const key in injections) {
    const injectionDefs = injections[key]
    if (injectionDefs) {
      const injectionName = `${key.toUpperCase().replace('$', '')}VueGlobals`
      writeLine(contents, `import { ${injectionName} } from "./globals";`)
      writeLine(contents, `declare module "./globals" {`)
      writeLine(contents, `export interface ${injectionName} {`)
      for (const defKey in injectionDefs) {
        writeLines(contents, injectionDefs[defKey], 1)
      }
      writeLine(contents, '}')
      writeLine(contents, '}')
    }
  }

  writeLine(contents)

  // Extend Vue instance with injections
  if (injections) {
    writeLine(contents, `declare module 'vue/types/vue' {`)
    writeLine(contents, 'interface Vue {', 1)

    for (const key3 in injections) {
      writeLine(contents, `${key3}: ${key3.toUpperCase().replace('$', '')}VueGlobals`, 2)
    }
    writeLine(contents, '}', 1)
    writeLine(contents, '}')
  }

  addQuasarPluginOptions(contents, components, directives, plugins)

  quasarTypeContents.forEach(line => write(contents, line))

  writeLine(contents, `export const Quasar: PluginObject<Partial<QuasarPluginOptions>>`)
  writeLine(contents)

  writeLine(contents, `import './vue'`)

  writeFile(resolvePath('index.d.ts'), contents.join(''))
}

module.exports.generate = function (data) {
  const apis = data.plugins
    .concat(data.directives)
    .concat(data.components)

  try {
    copyPredefinedTypes(typeRoot)
    writeIndexDTS(apis)
  }
  catch (err) {
    logError(`build.types.js: something went wrong...`)
    console.log()
    console.error(err)
    console.log()
    process.exit(1)
  }
}
