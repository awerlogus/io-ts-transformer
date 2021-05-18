import * as ts from 'typescript'
import * as path from 'path'
import * as resolve from 'resolve'


// Settings

// Name of the index.d.ts entities
const decoderFunctionName = 'buildDecoder'
const fromIoTsTypeName = 'FromIoTs'

// io-ts import paths
const ioTsPaths = [
  getRealPath('../io-ts/lib/index.js'),
  getRealPath('../io-ts/es6/index.js'),
  getRealPath('node_modules/io-ts/es6/index.js'),
  getRealPath('node_modules/io-ts/lib/index.js')
]

const isIoTsImport = isImportDeclarationWithOneOfPaths(ioTsPaths)

// buildDecoder function location path
const indexJsPath = getRealPath('index.js')

const isIndexJsImport = isImportDeclarationWithOneOfPaths([indexJsPath])

// buildDecoder function declaration path
const indexTsPath = getRealPath('index.d.ts')


/**
 * Main transformer function should be used by the end user
 */

export default function transform(program: ts.Program): ts.TransformerFactory<ts.SourceFile> {

  console.log(`[io-ts-transformer info]: If you will get any problems using this transformer, please
  leave an issue on GitHub https://github.com/awerlogus/io-ts-transformer/issues with your types example`)

  return (context: ts.TransformationContext) => (file: ts.SourceFile) => {

    // If in the file no import of buildDecoder function, don't change it
    if (!getDirectChildren(file).some(isIndexJsImport))
      return file

    const typeChecker = program.getTypeChecker()

    // Check if buildDecoder function is used not as a call expression
    if (someOfNodeOrChildren(isWrongTransformFunctionUsage(typeChecker, decoderFunctionName, indexTsPath))(file))
      throw new Error(`${decoderFunctionName} function should used as a call expression only`)

    // Check if namespace alias used not to access it's property
    if (someOfNodeOrChildren(isNamespaceUsedNotAsPropAccess(typeChecker, indexTsPath))(file))
      throw new Error(`io-ts-transformer namespace alias used not to access it's property`)

    // If there is no call of buildDecoder function in the file, don't change it
    if (!someOfNodeOrChildren(isFunctionCallExpression(decoderFunctionName, indexTsPath)(typeChecker)))
      return file

    // If io-ts namespace is already imported, find its alias name. Otherwise find
    // free name for io-ts alias and replace single index.js import with io-ts import
    const ioTsPriorName = getIoTsAliasName(file)

    const ioTsAliasName = ioTsPriorName ?? findFreeName(isNameFree(file), 'io')

    const replaceIndexNode = () => {

      const replacer = getSingleNodeReplacer(
        isIndexJsImport, createNamespaceImportDeclaration(ioTsAliasName, 'io-ts')
      )

      return ts.visitEachChild(file, node => replacer(node, program), context)
    }

    const file1 = ioTsPriorName === undefined ? replaceIndexNode() : file

    // Find all FromIoTs type usages and map it's type ids to referenced constant names.
    // Also check it's used only with 'typeof' keyword and throw error otherwise.
    const fromIoTsUsages = findFromIoTsUsages(file, typeChecker)

    // Replace all buildDecoder function calls with io-ts
    // type entities and remove all index.js imports
    return mapNodeAndChildren(file1, program, context, getNodeVisitor(ioTsAliasName, fromIoTsUsages, context))
  }
}


/**
 * Represents function that maps single node
 */

type MappingFunction = {
  (node: ts.SourceFile, program: ts.Program): ts.SourceFile
  (node: ts.Node, program: ts.Program): ts.Node | undefined
}


/**
 * Maps all nodes of source file
 * or single node with all children
 * nodes with mapper function passed
 */

function mapNodeAndChildren(
  node: ts.SourceFile, program: ts.Program, context: ts.TransformationContext, mapper: MappingFunction
): ts.SourceFile

function mapNodeAndChildren(
  node: ts.Node, program: ts.Program, context: ts.TransformationContext, mapper: MappingFunction
): ts.Node | undefined

function mapNodeAndChildren(
  node: ts.Node, program: ts.Program, context: ts.TransformationContext, mapper: MappingFunction
): ts.Node | undefined {

  const visitor = (childNode: ts.Node) => mapNodeAndChildren(childNode, program, context, mapper)

  return ts.visitEachChild(mapper(node, program), visitor, context)
}


/**
 * Returns aliased symbol of ts.Symbol or
 * this symbol itself if it is aliased
 */

function getAliasedSymbol(symbol: ts.Symbol, typeChecker: ts.TypeChecker): ts.Symbol {

  try {
    return typeChecker.getAliasedSymbol(symbol)
  } catch (_) { return symbol }
}


/**
 * Returns aliased symbol of ts.Identifier
 */

function getAliasedSymbolOfNode(node: ts.Identifier, typeChecker: ts.TypeChecker): ts.Symbol | undefined {

  const symbol = typeChecker.getSymbolAtLocation(node)

  if (symbol === undefined)
    return undefined

  return getAliasedSymbol(symbol, typeChecker)
}


/**
 * Checks is symbol belongs to declaration
 * with name 'name' located in file filePath
 */

function isSymbolOf(symbol: ts.Symbol, name: string, filePath: string): boolean {

  if (symbol.escapedName !== name)
    return false

  return [symbol.valueDeclaration, ...symbol.declarations].filter(Boolean)
    .some(declaration => path.join(declaration.getSourceFile().fileName) === filePath)
}


/**
 * Checks is ts.Identifier being an alias of node
 * with name 'name' declared in the file filePath
 */

function isAliasIdentifierOf(node: ts.Identifier, typeChecker: ts.TypeChecker, name: string, filePath: string): boolean {

  const symbol = getAliasedSymbolOfNode(node, typeChecker)

  return symbol !== undefined && isSymbolOf(symbol, name, filePath)
}


/**
 * Returns NodePredicate that checks if the node is being
 * the identifier that refers the function with name
 * functionName, declared in the file with name filePath,
 * and this identifier is being used not as a call expression
 */

function isWrongTransformFunctionUsage(typeChecker: ts.TypeChecker, functionName: string, filePath: string): NodePredicate {

  return node => {

    if (!ts.isIdentifier(node) || ts.isImportSpecifier(node.parent))
      return false

    if (ts.isCallExpression(node.parent) && !node.parent.arguments.includes(node))
      return false

    if (!ts.isPropertyAccessExpression(node.parent))
      return isAliasIdentifierOf(node, typeChecker, functionName, filePath)

    const expression = node.parent.expression

    if (!ts.isIdentifier(expression))
      return false

    if (isAliasIdentifierOf(expression, typeChecker, functionName, filePath))
      return true

    const name = node.parent.name

    if (!ts.isIdentifier(name))
      return false

    if (!isAliasIdentifierOf(name, typeChecker, functionName, filePath))
      return false

    return !ts.isCallExpression(node.parent.parent) || node.parent.parent.arguments.includes(node.parent)
  }
}


/**
 * Returns NodePredicate that checks is node
 * being the namespace alias of file with name
 * filePath and it's used not to access it's property
 */

function isNamespaceUsedNotAsPropAccess(typeChecker: ts.TypeChecker, filePath: string): NodePredicate {

  return node => {

    if (!ts.isIdentifier(node))
      return false

    if (ts.isPropertyAccessOrQualifiedName(node.parent))
      return false

    if (ts.isNamespaceImport(node.parent))
      return false

    const symbol = getAliasedSymbolOfNode(node, typeChecker)

    const declaration = symbol?.valueDeclaration

    if (declaration === undefined || !ts.isSourceFile(declaration))
      return false

    return path.join(declaration.fileName) === filePath
  }
}


/**
 * Finds all FromIoTs usages in the file
 * and returns a record of type ids and
 * expressions that types to be replaced
 */

function findFromIoTsUsages(file: ts.SourceFile, typeChecker: ts.TypeChecker): Record<number, string> {

  const handleNode = (node: ts.Identifier): Record<number, string> => {

    if (ts.isImportSpecifier(node.parent))
      return {}

    const symbol = getAliasedSymbolOfNode(node, typeChecker)

    if (symbol === undefined || !isSymbolOf(symbol, fromIoTsTypeName, indexTsPath))
      return {}

    const parent = ts.isPropertyAccessOrQualifiedName(node.parent) ? node.parent.parent : node.parent

    const args = (<any>parent).typeArguments[0]._children

    if (args[0].kind !== ts.SyntaxKind.TypeOfKeyword)
      throw new Error(`${fromIoTsTypeName} type must be used with 'typeof' parameter only`)

    if (!ts.isIdentifier(args[1]))
      throw new Error(`${fromIoTsTypeName} type can accept typeof identifier only`)

    const type = typeChecker.getTypeFromTypeNode(<any>parent)

    return { [getTypeId(type)]: String(args[1].escapedText) }
  }

  const visitor = (node: ts.Node): Record<number, string> => {

    const nodeResult = ts.isIdentifier(node) ? handleNode(node) : {}

    const childrenResult = node.getChildren().map(visitor)

    return [nodeResult, ...childrenResult].reduce(mergeObjects)
  }

  return visitor(file)
}


/**
 * Returns array of direct children of ts.Node
 */

function getDirectChildren(node: ts.Node): ts.Node[] {

  const children = node.getChildren()

  if (!ts.isSourceFile(node))
    return children

  if (children.length === 0)
    return []

  return children[0].getChildren()
}


/**
 * Predicate accepts ts.Node or it's subtypes
 */

type NodePredicate<T extends ts.Node = ts.Node> = (node: T) => boolean


/**
 * Returns NodePredicate which returns true if
 * the node itself or any of all it's children
 * satisfies the predicate passed
 */

function someOfNodeOrChildren(predicate: NodePredicate): NodePredicate {

  return node => {

    if (predicate(node))
      return true

    return node
      .getChildren()
      .some(someOfNodeOrChildren(predicate))
  }
}


/**
 * Returns real path of ts.ImportDeclaration node
 */

function getImportNodeRealPath(node: ts.ImportDeclaration): string {

  const module = (node.moduleSpecifier as ts.StringLiteral).text

  const nodePath = module.startsWith('.')
    ? path.resolve(path.dirname(node.getSourceFile().fileName), module)
    : module

  try {
    return require.resolve(nodePath)
  } catch(e) {
    // attempt to resolve file path with typescript extensions
    return resolve.sync(nodePath, {extensions: ['.ts', '.tsx']})
  }
}


/**
 * Returns NodePredicate which returns
 * true if node is ImportDeclaration and
 * matches one of provided import paths
 */

function isImportDeclarationWithOneOfPaths(paths: string[]) {

  return (node: ts.Node): node is ts.ImportDeclaration =>

    ts.isImportDeclaration(node) && paths.includes(getImportNodeRealPath(node))
}


/**
 * builds real path by relative path
 */

function getRealPath(filePath: string): string {

  return path.join(__dirname, filePath)
}


/**
 * Returns function that accepts TypeChecker and returns
 * NodePredicate that checks does the node passed being
 * the call expression of function with name functionName
 * which is declared in file with path declarationFilePath
 */

function isFunctionCallExpression(functionName: string, declarationFilePath: string) {

  return (typeChecker: ts.TypeChecker) => (node: ts.Node): node is ts.CallExpression => {

    if (!ts.isCallExpression(node))
      return false

    const signature = typeChecker.getResolvedSignature(node)

    const declaration = signature?.declaration

    return declaration !== undefined
      && !ts.isJSDocSignature(declaration)
      && declaration.name !== undefined
      && declaration.name.getText() === functionName
      && (path.join(declaration.getSourceFile().fileName) === declarationFilePath)
  }
}


/**
 * Returns true if identifier name is
 * not exists in passed source file
 */

function isNameFree(file: ts.SourceFile) {

  return (name: string): boolean =>

    !someOfNodeOrChildren(node =>
      ts.isIdentifier(node)
      && node.getText() === name
      // Object property names may be used for modules
      && !ts.isPropertyAccessExpression(node.parent)
      && !ts.isPropertySignature(node.parent)
      && !ts.isPropertyAssignment(node.parent)
    )(file)
}


/**
 * Checks is string consisting only of numbers
 */

function isNumberString(string: string): boolean {

  return string.match(/^\d+$/) !== null
}


/**
 * Returns last symbol of the string or an
 * empty string if the string is empty
 */

function getLastSymbol(string: string): string {

  const { length } = string

  return length !== 0 ? string[length - 1] : ''
}


/**
 * Finds free name for the new variable.
 * Using template as a base for the name.
 * If template contains '@', it will be replaced
 * with a number, if the name will be not free.
 * Otherwise number will be added to the end of
 * template.
 */

function findFreeName(isNameFree: (name: string) => boolean, template: string): string {

  const defaultName = template
    .replace('_@_', '_')
    .replace(/_@$/, '')
    .replace('@', '')

  if (isNameFree(defaultName))
    return defaultName

  // Builds name by adding a number to the template
  const buildName = (index: number): string => {

    if (template.includes('@'))
      return template.replace('@', index.toString())

    if (isNumberString(getLastSymbol(template)))
      return template + '_' + index.toString()

    return template + index.toString()
  }

  // If name is not free, try add a number to it
  const nextIteration = (index: number): string => {

    const name = buildName(index)

    if (isNameFree(name))
      return name

    return nextIteration(index + 1)
  }

  return nextIteration(0)
}


/**
 * Returns name of alias if ts.ImportDeclaration is
 * being a ts.NamespaceImport or undefined otherwise
 */

function getNamespaceImportAliasName(node: ts.ImportDeclaration): string | undefined {

  const bindings = node.importClause?.namedBindings

  if (bindings === undefined || !ts.isNamespaceImport(bindings))
    return undefined

  // ['*', 'as', 'aliasName']
  return bindings.getChildAt(2).getText()
}


/**
 * Returns io-ts namespace import alias
 * or undefined if it was not imported
 */

function getIoTsAliasName(file: ts.SourceFile): string | undefined {

  const name = getDirectChildren(file)
    .filter(isIoTsImport)
    .map(getNamespaceImportAliasName)
    .find(Boolean)

  if (name === undefined)
    return undefined

  // if io-ts import is unused in code, it will be
  // removed by compiler and cannot be used by us
  return someOfNodeOrChildren(
    node => ts.isIdentifier(node)
      && !ts.isNamespaceImport(node.parent)
      && node.getText() === name
  )(file) ? name : undefined
}


/**
 * Creates ImportDeclaration of namespace with
 * name namespaceName and alias named AliasName
 */

function createNamespaceImportDeclaration(aliasName: string, namespaceName: string): ts.ImportDeclaration {

  return ts.createImportDeclaration(
    undefined,
    undefined,
    ts.createImportClause(
      undefined,
      ts.createNamespaceImport(ts.createIdentifier(aliasName))
    ),
    ts.createStringLiteral(namespaceName)
  )
}


/**
 * Returns mapping function that replaces
 * single node satisfies the passed predicate
 * with a replacement node passed
 */

function getSingleNodeReplacer(predicate: NodePredicate, replacement: ts.Node): MappingFunction {

  let replaced = false

  return (node: any) => {

    if (replaced || !predicate(node))
      return node

    replaced = true

    return replacement
  }
}


/**
 * Creates PropertyAccessExpression for property with
 * name propertyName of object with name objectName
 */

function createPropertyAccess(objectName: string, propertyName: string): ts.PropertyAccessExpression {

  return ts.createPropertyAccess(ts.createIdentifier(objectName), ts.createIdentifier(propertyName))
}


/**
 * Creates ts.ExpressionStatement which is call
 * of method with name methodName of object with
 * name objectName and passes params into it
 */

function createMethodCall(objectName: string, methodName: string, params: ts.Expression[]): ts.CallExpression {

  return ts.createCall(createPropertyAccess(objectName, methodName), undefined, params)
}


/**
 * Checks is ts.Type being the ts.TupleType
 */

function isTupleType(type: ts.Type, typeChecker: ts.TypeChecker): type is ts.TupleType {

  return (<any>typeChecker).isTupleType(type)
}


/**
 * Checks is ts.Type being the Array or ReadonlyArray type
 */

function isArrayType(type: ts.Type, typeChecker: ts.TypeChecker): type is ts.GenericType {

  return (<any>typeChecker).isArrayType(type)
}


/**
 * Checks is ts.Type being the Record type
 */

function isRecordType(type: ts.Type): type is ts.GenericType {

  return type.aliasSymbol?.getName() === 'Record'
}


/**
 * Checks is ts.Type being the ts.ObjectType
 */

function isObjectType(type: ts.Type): type is ts.ObjectType {

  return type.symbol?.getName() === '__type'
}


/**
 * Checks is ts.Type being a function
 */

function isFunctionType(type: ts.Type): boolean {

  return type.getCallSignatures().length !== 0
}


/**
 * Checks is ts.Type being a type alias
 */

function isTypeAlias(type: ts.Type): boolean {

  if (type.isClassOrInterface())
    return true

  const nodes = type.aliasSymbol?.declarations

  return nodes !== undefined && nodes.some(ts.isTypeAliasDeclaration)
}


/**
 * Represents result of transformation.
 *
 * Aliases property is a record where keys are ids
 * of types that must be represented as constants later,
 * and values are expressions must be assigned to these constants.
 * NodesCount property is a record contains count of types converted.
 * Recursions property is a list of recursive types.
 */

type TransformationResult = {
  aliases: Record<number, ts.Expression>
  nodesCount: Record<number, number>
  recursions: number[]
}


/**
 * Represents result of type transformation.
 *
 * NodeResult is expression that represents value
 * of transformed type (literal or constant
 * reference for recursive type cases).
 */

type TypeTransformationResult<T extends ts.Expression = ts.Expression> =

  TransformationResult & { nodeResult: T }


/**
 * Represents result of types array transformation.
 *
 * NodesResult is array of expressions that represents
 * values of transformed types (literal or constant
 * references for recursive type cases).
 */

type TypeArrayTransformationResult<T extends ts.Expression = ts.Expression> =

  TransformationResult & { nodesResult: T[] }


/**
 * Represents data necessary to transform node
 *
 * Stack property contains stack of type ids
 * of current transformation call stack.
 * Computed property contains array of type ids
 * that may be replaced by constant
 */

type TransformationData = {
  stack: number[]
  computed: number[]
  fromIoTsUsages: Record<number, string>
}


/**
 * Returns id of ts.Type
 */

function getTypeId(type: ts.Type): number {

  return (<any>type).id
}


/**
 * Concatenates two arrays and removes duplicates
 */

function mergeArrays<T>(array1: T[], array2: T[]): T[] {

  return [...new Set([...array1, ...array2])]
}


/**
 * Merges two objects
 */

function mergeObjects<K extends string | number, V>(obj1: Record<K, V>, obj2: Record<K, V>): Record<K, V> {

  return { ...obj1, ...obj2 }
}


/**
 * Merges two number objects. Result
 * object value is sum of these objects values
 */

function mergeNumberObjects(obj1: Record<number, number>, obj2: Record<number, number>): Record<number, number> {

  const result = { ...obj1 }

  const keys = getObjectNumberKeys(obj2)

  keys.forEach(key => result[key] = (obj1[key] ?? 0) + obj2[key])

  return result
}


/**
 * Returns keys of object where keys are numbers
 */

function getObjectNumberKeys(object: Record<number, unknown>): number[] {

  // Don't make parseInt call point-free
  return Object.keys(object).map(num => parseInt(num))
}


/**
 * Merges array of TransformationResult to single TransformationResult
 */

function mergeTransformationResultArray(array: TransformationResult[]): TransformationResult {

  const aliases = array.map(res => res.aliases).reduce(mergeObjects, {})

  const recursions = array.map(res => res.recursions).reduce(mergeArrays, [])

  const nodesCount = array.map(res => res.nodesCount).reduce(mergeNumberObjects, {})

  return { aliases, recursions, nodesCount }
}


/**
 * Converts array of TypeTransformationResult to TypeArrayTransformationResult
 */

function mergeTypeTransformationResultArray(array: TypeTransformationResult[]): TypeArrayTransformationResult {

  return { nodesResult: array.map(res => res.nodeResult), ...mergeTransformationResultArray(array) }
}


/**
 * Converts an array of types to TypeArrayTransformationResult
 */

function convertTypesArray(
  types: readonly ts.Type[], namespace: string, typeChecker: ts.TypeChecker, data: TransformationData
): TypeArrayTransformationResult {

  const transformNextType = (
    types: readonly ts.Type[], data: TransformationData, result: TypeTransformationResult[]
  ): TypeTransformationResult[] => {

    if (types.length === 0)
      return result

    const [head, ...tail] = types

    const res = convertTypeToIoTs(head, namespace, typeChecker, data)

    const computed = mergeArrays(data.computed, getObjectNumberKeys(res.nodesCount))

    return transformNextType(tail, { ...data, computed }, [...result, res])
  }

  return mergeTypeTransformationResultArray(transformNextType(types, data, []))
}


/**
 * Converts ts.UnionType to TypeTransformationResult
 */

function convertUnionType(
  type: ts.UnionType, namespace: string, typeChecker: ts.TypeChecker, data: TransformationData
): TypeTransformationResult {

  const nodes = type.aliasSymbol?.declarations

  const types = nodes !== undefined && nodes.length !== 0 && (<any>nodes[0]).type !== undefined
    ? (<any>nodes[0]).type.types.map(typeChecker.getTypeFromTypeNode)
    : type.types

  const result = convertTypesArray(types, namespace, typeChecker, data)

  const nodeResult = createMethodCall(namespace, 'union', [ts.createArrayLiteral(result.nodesResult)])

  return { ...result, nodeResult }
}


/**
 * Converts ts.TupleType to TypeTransformationResult
 */

function convertTupleType(
  type: ts.TupleType, namespace: string, typeChecker: ts.TypeChecker, data: TransformationData
): TypeTransformationResult {

  const result = convertTypesArray((<any>type).resolvedTypeArguments, namespace, typeChecker, data)

  const nodeResult = createMethodCall(namespace, 'tuple', [ts.createArrayLiteral(result.nodesResult)])

  return { ...result, nodeResult }
}


/**
 * Converts Array or ReadonlyArray types TypeTransformationResult
 */

function convertArrayType(
  type: ts.GenericType, namespace: string, typeChecker: ts.TypeChecker, data: TransformationData
): TypeTransformationResult {

  const arrayType = type.getSymbol()?.escapedName === 'ReadonlyArray' ? 'readonlyArray' : 'array'

  const args = type.typeArguments

  if (args === undefined || args.length === 0)
    throw new Error('Array must have type arguments')

  const result = convertTypeToIoTs(args[0], namespace, typeChecker, data)

  const nodeResult = createMethodCall(namespace, arrayType, [result.nodeResult])

  return { ...result, nodeResult }
}


/**
 * Converts Record type to to TypeTransformationResult
 */

function convertRecordType(
  type: ts.GenericType, namespace: string, typeChecker: ts.TypeChecker, data: TransformationData
): TypeTransformationResult {

  const args = type.aliasTypeArguments

  if (args === undefined)
    throw new Error('Record must have type arguments')

  const result = convertTypesArray(args, namespace, typeChecker, data)

  const nodeResult = createMethodCall(namespace, 'record', result.nodesResult)

  return { ...result, nodeResult }
}


/**
 * Checks does property declaration matched as optional
 */

function isOptionalPropertyDeclaration(prop: ts.Symbol): boolean {

  const property = prop.valueDeclaration as ts.PropertyDeclaration

  return property.questionToken !== undefined
}


/**
 * Checks does property declaration matched as readonly
 */

function isReadonlyPropertyDeclaration(prop: ts.Symbol): boolean {

  const { modifiers } = prop.valueDeclaration

  if (modifiers === undefined)
    return false

  return modifiers.some(token => token.kind === ts.SyntaxKind.ReadonlyKeyword)
}


/**
 * Extracts property type and name from ts.Symbol
 */

function extractProperty(prop: ts.Symbol, typeChecker: ts.TypeChecker): { name: string, type: ts.Type } {

  const declaration = prop.valueDeclaration

  const type = (<any>prop).type === undefined
    ? typeChecker.getTypeFromTypeNode((<any>declaration).type)
    : (<any>prop).type.target ?? (<any>prop).type

  const name = String(prop.escapedName)

  return { name, type }
}


/**
 * Builds name for property.
 * If it is simple, use just string.
 * For complex names wrap it into ts.StringLiteral
 */

function buildPropertyName(name: string): string | ts.StringLiteral {

  if (name.match(/^[a-zA-Z_]+[\w_]+$/) !== null)
    return name

  return ts.createStringLiteral(name)
}


/**
 * Separates an array into two arrays:
 * the first array contains elements matched
 * by predicate as true, the second as false.
 */
function separateArray<T>(array: T[], predicate: (element: T) => boolean): [T[], T[]] {

  const nextIteration = (array: T[], onTrue: T[], onFalse: T[]): [T[], T[]] => {

    if (array.length === 0)
      return [onTrue, onFalse]

    const [head, ...tail] = array

    if (predicate(head))
      return nextIteration(tail, [...onTrue, head], onFalse)

    return nextIteration(tail, onTrue, [...onFalse, head])
  }

  return nextIteration(array, [], [])
}

/**
 * Converts Array of object properties to io-ts TransformationResult. If there are
 * readonly or optional properties, they will be built as separate
 * objects and mixed to main object using t.intersection function
 */

function convertObjectType(
  props: ts.Symbol[], namespace: string, typeChecker: ts.TypeChecker, data: TransformationData
): TypeTransformationResult {

  if (props.length === 0)
    return wrapToTypeTransformationResult(createMethodCall(namespace, 'type', [ts.createObjectLiteral([])]))

  const preparedProps = props.map(prop => {

    const origin = (prop as any).syntheticOrigin

    return origin !== undefined ? origin : prop
  })

  // separate properties by two
  // criteria (readonly, optional)
  // and get four property lists
  // for each criteria combination

  const [readonlyProps, editableProps] = separateArray(preparedProps, isReadonlyPropertyDeclaration)

  const [readonlyOptionalProps, readonlyNonOptionalProps] = separateArray(readonlyProps, isOptionalPropertyDeclaration)

  const [editableOptionalProps, editableNonOptionalProps] = separateArray(editableProps, isOptionalPropertyDeclaration)

  // Builds io-ts t.type (or t.partial) entity by property list
  const handlePropList = (props: ts.Symbol[], isPartial: boolean, data: TransformationData) => {

    const handledProps = props.map(prop => extractProperty(prop, typeChecker))

    const types = handledProps.map(prop => prop.type)

    const result = convertTypesArray(types, namespace, typeChecker, data)

    const properties = result.nodesResult.map(
      (p, i) => ts.createPropertyAssignment(buildPropertyName(handledProps[i].name), p)
    )

    const objectType = isPartial ? 'partial' : 'type'

    const nodeResult = createMethodCall(namespace, objectType, [ts.createObjectLiteral(properties)])

    return { ...result, nodeResult }
  }

  // Build 4 (or less) objects for each
  // (+-readonly and +-optional) case
  // and add it to the result array
  const result: TypeTransformationResult[] = []

  const handleReadonlyProps = (props: ts.Symbol[], isPartial: boolean, data: TransformationData) => {

    const res = handlePropList(props, isPartial, data)

    const nodeResult = createMethodCall(namespace, 'readonly', [res.nodeResult])

    return { ...res, nodeResult }
  }

  let newData = data

  if (readonlyOptionalProps.length !== 0) {

    const res = handleReadonlyProps(readonlyOptionalProps, true, newData)

    const computed = mergeArrays(newData.computed, getObjectNumberKeys(res.nodesCount))

    newData = { ...data, computed }

    result.push(res)
  }

  if (readonlyNonOptionalProps.length !== 0) {

    const res = handleReadonlyProps(readonlyNonOptionalProps, false, newData)

    const computed = mergeArrays(newData.computed, getObjectNumberKeys(res.nodesCount))

    newData = { ...data, computed }

    result.push(res)
  }

  if (editableOptionalProps.length !== 0) {

    const res = handlePropList(editableOptionalProps, true, newData)

    const computed = mergeArrays(newData.computed, getObjectNumberKeys(res.nodesCount))

    newData = { ...data, computed }

    result.push(res)
  }

  if (editableNonOptionalProps.length !== 0)
    result.push(handlePropList(editableNonOptionalProps, false, newData))

  const merged = mergeTypeTransformationResultArray(result)

  const nodeResult = result.length === 1
    ? result[0].nodeResult
    : createMethodCall(namespace, 'intersection', [ts.createArrayLiteral(merged.nodesResult)])

  return { ...merged, nodeResult }
}


/**
 * Converts interface type to to TypeTransformationResult
 */

function convertInterfaceType(
  type: ts.InterfaceType, namespace: string, typeChecker: ts.TypeChecker, data: TransformationData
): TypeTransformationResult {

  const props = (type as any).declaredProperties ?? []

  const object = convertObjectType(props, namespace, typeChecker, data)

  const parents = type.symbol.declarations
    .map((d: any) => d.heritageClauses)
    .filter(Boolean)
    .reduce(mergeArrays, [])
    .map((clause: any) => clause.types)
    .reduce(mergeArrays, [])
    .map(typeChecker.getTypeFromTypeNode)

  if (parents.length === 0)
    return object

  const newData = { ...data, computed: mergeArrays(data.computed, getObjectNumberKeys(object.nodesCount)) }

  const parentsTransformed = convertTypesArray(parents, namespace, typeChecker, newData)

  const nodesArray = [object.nodeResult, ...parentsTransformed.nodesResult]

  const nodeResult = createMethodCall(namespace, 'intersection', [ts.createArrayLiteral(nodesArray)])

  return { nodeResult, ...mergeTransformationResultArray([object, parentsTransformed]) }
}


/**
 * Wraps ts.Expression to TypeTransformationResult
 */

function wrapToTypeTransformationResult(node: ts.Expression): TypeTransformationResult {

  return { nodeResult: node, nodesCount: {}, recursions: [], aliases: {} }
}


/**
 * Builds TransformationResult for literal cases
 */

function createLiteralTransformationResult(namespace: string, literal: ts.Expression): TypeTransformationResult {

  return wrapToTypeTransformationResult(createMethodCall(namespace, 'literal', [literal]))
}


/**
 * Builds TransformationResult for basic type cases
 */

function createBasicTypeTransformationResult(namespace: string, typeName: string): TypeTransformationResult {

  return wrapToTypeTransformationResult(createPropertyAccess(namespace, typeName))
}


/**
 * Converts ts.Type entity to TypeTransformationResult
 */

function convertTypeToIoTs(
  type: ts.Type, namespace: string, typeChecker: ts.TypeChecker, data: TransformationData
): TypeTransformationResult {

  const stringType = typeChecker.typeToString(type)

  // Checking for error cases
  if (stringType === 'never')
    throw new Error('Never type transformation is not supported')

  if (type.isClass())
    throw new Error('Transformation of classes is not supported')

  // Check is FromIoTs expression
  const typeId = getTypeId(type)

  const fromIoTs = data.fromIoTsUsages[typeId]

  if (fromIoTs !== undefined)
    return wrapToTypeTransformationResult(ts.createIdentifier(fromIoTs))

  // Basic types transformation
  if (['null', 'undefined', 'void', 'unknown'].includes(stringType))
    return createBasicTypeTransformationResult(namespace, stringType)

  if (stringType === 'true' || stringType === 'false') {

    const literal = stringType === 'true' ? ts.createTrue() : ts.createFalse()

    return createLiteralTransformationResult(namespace, literal)
  }

  if (type.isStringLiteral())
    return createLiteralTransformationResult(namespace, ts.createStringLiteral(type.value))

  if (type.isNumberLiteral())
    return createLiteralTransformationResult(namespace, ts.createNumericLiteral(type.value.toString()))

  if (['string', 'number', 'boolean'].includes(stringType))
    return createBasicTypeTransformationResult(namespace, stringType)

  if (isFunctionType(type))
    return createBasicTypeTransformationResult(namespace, 'function')

  // Checking is the type already computed
  const isNamed = isTypeAlias(type)

  if (isNamed && data.computed.includes(typeId))
    return {
      nodeResult: ts.createIdentifier(generateNodeName(typeId, Object.values(data.fromIoTsUsages))),
      aliases: {},
      nodesCount: { [typeId]: 1 },
      recursions: data.stack.includes(typeId) ? data.stack.slice(data.stack.indexOf(typeId)) : []
    }

  // Complex types transformation
  const newData: TransformationData = {
    ...data,
    computed: mergeArrays(data.computed, [typeId]),
    stack: [...data.stack, typeId]
  }

  let result: TypeTransformationResult

  if (type.isUnion())
    result = convertUnionType(type, namespace, typeChecker, newData)

  else if (isTupleType(type, typeChecker))
    result = convertTupleType(type, namespace, typeChecker, newData)

  else if (isArrayType(type, typeChecker))
    result = convertArrayType(type, namespace, typeChecker, newData)

  else if (isRecordType(type))
    result = convertRecordType(type, namespace, typeChecker, newData)

  else if (type.isClassOrInterface())
    result = convertInterfaceType(type, namespace, typeChecker, newData)

  else if (isObjectType(type))
    result = convertObjectType(type.getProperties(), namespace, typeChecker, newData)

  else result = createBasicTypeTransformationResult(namespace, 'void')

  // Check if we need to enrich aliases property with this type
  const nodeResult = isNamed
    ? ts.createIdentifier(generateNodeName(typeId, Object.values(data.fromIoTsUsages)))
    : result.nodeResult

  const newAlias = isNamed ? { [typeId]: result.nodeResult } : {}

  const aliases = [result.aliases, newAlias].reduce(mergeObjects)

  // Increase nodesCount by 1 for this type id
  const nodesCount = mergeNumberObjects(result.nodesCount, { [typeId]: 1 })

  return { ...result, nodeResult, aliases, nodesCount }
}


/**
 * Creates ts.VariableStatement with 'const' keyword
 */

function createConstant(name: string, value: ts.Expression): ts.VariableStatement {

  const declaration = ts.createVariableDeclaration(ts.createIdentifier(name), undefined, value)

  const declarationList = ts.createVariableDeclarationList([declaration], ts.NodeFlags.Const)

  return ts.createVariableStatement(undefined, declarationList)
}


/**
 * Creates arrow function without of arguments and with body passed
 */

function createSimpleArrowFunction(body: ts.Expression | ts.Block): ts.ArrowFunction {

  return ts.createArrowFunction(
    undefined, undefined, [], undefined,
    ts.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    body
  )
}


/**
 * Wraps ts.Expression into t.recursion
 */

function createRecursiveTypeModel(namespace: string, name: string, model: ts.Expression): ts.VariableStatement {

  const recursion = createMethodCall(namespace, 'recursion', [
    ts.createStringLiteral(name),
    createSimpleArrowFunction(model)
  ])

  return createConstant(name, recursion)
}


/**
 * Generates name for node constant by its id
 */

function generateNodeName(id: number, occupiedNames: string[]): string {

  return findFreeName(name => !occupiedNames.includes(name), `node${id}_@`)
}


/**
 * Returns id of node being the type constant
 */

function getTypeConstantId(constant: ts.Identifier): number {

  const name = constant.text

  return parseInt(name.split('_')[0].replace('node', ''))
}


/**
 * Embeds constant expressions that was used only once
 */

function addConstantsOptimization(
  data: TypeTransformationResult, program: ts.Program, context: ts.TransformationContext
): TypeTransformationResult {

  const aliasKeys = getObjectNumberKeys(data.aliases)

  const embeddingIds = aliasKeys.filter(key => data.nodesCount[key] === 1)

  const transformed: Record<number, ts.Expression> = {}

  const mappingFunction: MappingFunction = (node: any) => {

    if (!ts.isIdentifier(node))
      return node

    const id = getTypeConstantId(node)

    if (embeddingIds.includes(id))
      return transformed[id] ?? data.aliases[id]

    return node
  }

  aliasKeys.forEach(key => transformed[key] = mapNodeAndChildren(data.aliases[key], program, context, mappingFunction) as ts.Expression)

  const nodeResult = mapNodeAndChildren(data.nodeResult, program, context, mappingFunction) as ts.Expression

  const aliases: Record<number, ts.Expression> = {}

  aliasKeys.forEach(key => { if (!embeddingIds.includes(key)) aliases[key] = transformed[key] })

  return { ...data, nodeResult, aliases }
}


/**
 * Returns namespace of node if this node is intersection
 */

function getIntersectionNodeNamespace(node: ts.Node): string | undefined {

  if (!ts.isCallExpression(node))
    return undefined

  const expression: any = node.expression

  const method = expression.name.escapedText

  if (method !== 'intersection')
    return undefined

  return expression.expression.escapedText
}


/**
 * Flats nested intersections
 */

function addNestedIntersectionsOptimization(
  data: TypeTransformationResult, program: ts.Program, context: ts.TransformationContext
): TypeTransformationResult {

  const aliasKeys = getObjectNumberKeys(data.aliases)

  const transformed: Record<number, ts.Expression> = {}

  const mappingFunction: MappingFunction = (node: any) => {

    const namespace = getIntersectionNodeNamespace(node)

    if (namespace === undefined)
      return node

    const elementList = (node.arguments[0] as any).elements.map((element: any) => {

      if (getIntersectionNodeNamespace(element) !== undefined)
        return (element.arguments[0] as any).elements

      return element
    })

    const elements = elementList.reduce(
      (acc: Array<ts.Node>, element: Array<ts.Node> | ts.Node) =>
        Array.isArray(element) ? [...acc, ...element] : [...acc, element], []
    )

    return createMethodCall(namespace, 'intersection', [ts.createArrayLiteral(elements)])
  }

  aliasKeys.forEach(key => transformed[key] = mapNodeAndChildren(data.aliases[key], program, context, mappingFunction) as ts.Expression)

  const nodeResult = mapNodeAndChildren(data.nodeResult, program, context, mappingFunction) as ts.Expression

  return { ...data, aliases: transformed, nodeResult }
}


/**
 * Merges elements of intersection with the same type
 */

function addMergingIntersectionElementsOptimization(
  data: TypeTransformationResult, program: ts.Program, context: ts.TransformationContext
): TypeTransformationResult {

  const aliasKeys = getObjectNumberKeys(data.aliases)

  const transformed: Record<number, ts.Expression> = {}

  const mappingFunction: MappingFunction = (node: any) => {

    const namespace = getIntersectionNodeNamespace(node)

    if (namespace === undefined)
      return node

    const elements = (node.arguments[0] as any).elements

    const readonlyPartialProps: Array<any> = []
    const readonlyNonPartialProps: Array<any> = []
    const partialProps: Array<any> = []
    const nonPartialProps: Array<any> = []
    const otherNodes: Array<any> = []

    elements.forEach((element: any) => {

      const name = element?.expression?.name?.escapedText

      if (name === 'readonly') {

        const argument = element.arguments[0]

        const argumentName = argument.expression.name.escapedText

        if (argumentName === 'type')
          readonlyNonPartialProps.push(argument.arguments[0])
        else readonlyPartialProps.push(argument.arguments[0])
      }

      else if (name === 'type')
        nonPartialProps.push(element.arguments[0])

      else if (name === 'partial')
        partialProps.push(element.arguments[0])

      else otherNodes.push(element)
    })

    const readonlyPartial = readonlyPartialProps.map(node => node.properties).reduce(mergeArrays, [])
    const readonlyNonPartial = readonlyNonPartialProps.map(node => node.properties).reduce(mergeArrays, [])
    const partial = partialProps.map(node => node.properties).reduce(mergeArrays, [])
    const nonPartial = nonPartialProps.map(node => node.properties).reduce(mergeArrays, [])

    const result = otherNodes.length !== 0 ? [...otherNodes] : []

    const createReadonly = (object: ts.Expression) => createMethodCall(namespace, 'readonly', [object])
    const createPartial = (object: ts.Expression) => createMethodCall(namespace, 'partial', [object])
    const createType = (object: ts.Expression) => createMethodCall(namespace, 'type', [object])

    if (readonlyPartial.length !== 0)
      result.push(createReadonly(createPartial(ts.createObjectLiteral(readonlyPartial))))

    if (readonlyNonPartial.length !== 0)
      result.push((createReadonly(createType(ts.createObjectLiteral(readonlyNonPartial)))))

    if (partial.length !== 0)
      result.push((createPartial(ts.createObjectLiteral(partial))))

    if (nonPartial.length !== 0)
      result.push(createType(ts.createObjectLiteral(nonPartial)))

    if (result.length === 0)
      return createType(ts.createObjectLiteral())

    if (result.length === 1)
      return result[0]

    return createMethodCall(namespace, 'intersection', [ts.createArrayLiteral(result as any)])
  }

  aliasKeys.forEach(key => transformed[key] = mapNodeAndChildren(data.aliases[key], program, context, mappingFunction) as ts.Expression)

  const nodeResult = mapNodeAndChildren(data.nodeResult, program, context, mappingFunction) as ts.Expression

  return { ...data, aliases: transformed, nodeResult }
}


/**
 * Adds additional optimizations for built io-ts expressions
 */

function addPostOptimizations(
  data: TypeTransformationResult, program: ts.Program, context: ts.TransformationContext
): TypeTransformationResult {

  const constantsOptimized = addConstantsOptimization(data, program, context)

  const intersectionsFlat = addNestedIntersectionsOptimization(constantsOptimized, program, context)

  const intersectionElementsMerged = addMergingIntersectionElementsOptimization(intersectionsFlat, program, context)

  return intersectionElementsMerged
}


/**
 * Builds io-ts model by TypeTransformationResult
 */

function buildIoTsModeByTypeResult(
  result: TypeTransformationResult, namespace: string, occupiedNames: string[]
): ts.Expression {

  const { aliases, nodeResult } = result

  const ids = getObjectNumberKeys(aliases)

  if (ids.length === 0)
    return nodeResult

  const constants = ids.map(
    id => result.recursions.includes(id)
      ? createRecursiveTypeModel(namespace, generateNodeName(id, occupiedNames), aliases[id])
      : createConstant(generateNodeName(id, occupiedNames), aliases[id])
  )

  const iifeBlock = ts.createBlock([...constants, ts.createReturn(nodeResult)], true)

  return ts.createCall(ts.createParen(createSimpleArrowFunction(iifeBlock)), undefined, [])
}


/**
 * Converts ts.Type entity to io-ts type entity
 */

function convertTypeToIoTsType(
  type: ts.Type,
  namespace: string,
  fromIoTsUsages: Record<number, string>,
  typeChecker: ts.TypeChecker,
  program: ts.Program,
  context: ts.TransformationContext
): ts.Expression {

  const initialData: TransformationData = { computed: [], stack: [], fromIoTsUsages }

  const result = convertTypeToIoTs(type, namespace, typeChecker, initialData)

  const optimizedResult = addPostOptimizations(result, program, context)

  return buildIoTsModeByTypeResult(optimizedResult, namespace, Object.values(fromIoTsUsages))
}


/**
 * Removes from usages names of constants in the node stack
 */

function normalizeFromIoTsUsages(usages: Record<number, string>, node: ts.Node): Record<number, string> {

  if (ts.isSourceFile(node) || !ts.isVariableDeclaration(node.parent))
    return usages

  const copy = { ...usages }

  const keys = getObjectNumberKeys(copy)

  keys.forEach(key => copy[key] === ((<any>node).parent.name).escapedText && delete copy[key])

  return copy
}


/**
 * Removes node if it is index.js import and replaces
 * buildDecoder function call with io-ts type entity
 */

function getNodeVisitor(
  ioTsInstanceName: string, fromIoTsUsages: Record<number, string>, context: ts.TransformationContext
): MappingFunction

function getNodeVisitor(
  ioTsInstanceName: string, fromIoTsUsages: Record<number, string>, context: ts.TransformationContext
) {

  return (node: ts.Node, program: ts.Program) => {

    if (isIndexJsImport(node))
      return undefined

    const typeChecker = program.getTypeChecker()

    if (!isFunctionCallExpression(decoderFunctionName, indexTsPath)(typeChecker)(node))
      return node

    const typeArguments = node.typeArguments

    if (typeArguments === undefined || typeArguments.length === 0)
      throw new Error(`Please pass a type argument to the ${decoderFunctionName} function`)

    const type = typeChecker.getTypeFromTypeNode(typeArguments[0])

    const usages = normalizeFromIoTsUsages(fromIoTsUsages, node)

    return convertTypeToIoTsType(type, ioTsInstanceName, usages, typeChecker, program, context)
  }
}
