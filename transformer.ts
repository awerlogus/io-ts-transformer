import * as ts from 'typescript'
import * as path from 'path'


// Settings

// Name of the transforming function
const functionName = 'buildDecoder'

// io-ts import paths
const ioTsLibJsPath = getRealPath('node_modules/io-ts/lib/index.js')
const ioTsEsJsPath = getRealPath('node_modules/io-ts/es6/index.js')

const isIoTsImport = isImportDeclarationWithOneOfPaths([ioTsEsJsPath, ioTsLibJsPath])

// buildDecoder function location path
const indexJsPath = getRealPath('index.js')

const isIndexJsImport = isImportDeclarationWithOneOfPaths([indexJsPath])

// buildDecoder function declaration path
const indexTsPath = getRealPath('index.d.ts')


/**
 * Main transformer function should be used by the end user
 */

export default function transform(program: ts.Program): ts.TransformerFactory<ts.SourceFile> {

  return (context: ts.TransformationContext) => (file: ts.SourceFile) => {

    // If in the file no import of buildDecoder function, don't change it
    if (!getDirectChildren(file).some(isIndexJsImport))
      return file

    const typeChecker = program.getTypeChecker()

    // If there is no call of buildDecoder function in the file, don't change it
    if (!someOfNodeOrChildren(isFunctionCallExpression(functionName, indexTsPath)(typeChecker)))
      return file

    // If io-ts namespace is already imported, find its alias name. Otherwise find
    // free name for io-ts alias and replace single index.js import with io-ts import
    const ioTsPriorName = getIoTsAliasName(file)

    const ioTsAliasName = ioTsPriorName ?? findFreeName(file, 'io')

    const replacer = getSingleIndexToIoTsImportReplacer(ioTsAliasName)

    const file1 = ioTsPriorName === undefined ? ts.visitEachChild(
      file, node => replacer(node, program), context
    ) : file

    // Replace all buildDecoder function calls with io-ts
    // type entities and remove all index.js imports
    return mapNodeAndChildren(file1, program, context, getNodeVisitor(ioTsAliasName))
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

  return require.resolve(nodePath)
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

function isNameFree(file: ts.SourceFile, name: string): boolean {

  return !someOfNodeOrChildren(node =>
    ts.isIdentifier(node) &&
    node.getText() === name &&
    // Object property names may be used for modules
    !ts.isPropertyAccessExpression(node.parent) &&
    !ts.isPropertySignature(node.parent) &&
    !ts.isPropertyAssignment(node.parent)
  )(file)
}


/**
 * Finds free name for new variable
 */

function findFreeName(file: ts.SourceFile, template: string): string {

  if (isNameFree(file, template))
    return template

  // if name is not free, try name0, name1...
  const nextIteration = (index: number): string => {

    const name = template + index

    if (isNameFree(file, name))
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

  return getDirectChildren(file)
    .filter(isIoTsImport)
    .map(getNamespaceImportAliasName)
    .find(Boolean)
}


/**
 * Creates ImportDeclaration of namespace with
 * name namespaceName and alias named AliasName
 */

function getNamespaceImportDeclaration(aliasName: string, namespaceName: string): ts.ImportDeclaration {

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
 * single index.js import with io-ts
 * import with alias name aliasName
 */

function getSingleIndexToIoTsImportReplacer(aliasName: string): MappingFunction {

  let replaced = false

  return (node: any) => {

    if (replaced || !isIndexJsImport(node))
      return node

    replaced = true

    return getNamespaceImportDeclaration(aliasName, 'io-ts')
  }
}


/**
 * Creates PropertyAccessExpression for property with
 * name propertyName of object with name objectName
 */

function getPropertyAccess(objectName: string, propertyName: string): ts.PropertyAccessExpression {

  return ts.createPropertyAccess(ts.createIdentifier(objectName), ts.createIdentifier(propertyName))
}


/**
 * Creates ts.ExpressionStatement which is call
 * of method with name methodName of object with
 * name objectName and passes params into it
 */

function getMethodCall(objectName: string, methodName: string, params: ts.Expression[]): ts.CallExpression {

  return ts.createCall(getPropertyAccess(objectName, methodName), undefined, params)
}


/**
 * Checks is ts.Type being the ts.TupleType
 */

function isTupleType(type: ts.Type, typeChecker: ts.TypeChecker): type is ts.TupleType {

  const unsafeChecker: any = typeChecker

  return unsafeChecker.isTupleType(type)
}


/**
 * Checks is ts.Type being the Array or ReadonlyArray type
 */

function isArrayType(type: ts.Type, typeChecker: ts.TypeChecker): type is ts.GenericType {

  const unsafeChecker: any = typeChecker

  return unsafeChecker.isArrayType(type)
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
 * Converts ts.TupleType to io-ts type entity
 */

function convertTupleToIoTs(type: ts.TupleType, namespace: string, typeChecker: ts.TypeChecker): ts.Expression {

  const elements = (type as any).resolvedTypeArguments.map(
    (element: ts.Type) => convertTypeToIoTsType(element, namespace, typeChecker)
  )

  return getMethodCall(namespace, 'tuple', [ts.createArrayLiteral(elements)])
}


/**
 * Converts Record type to io-ts type entity
 */

function convertRecordToIoTs(type: ts.GenericType, namespace: string, typeChecker: ts.TypeChecker): ts.Expression {

  const args = type.aliasTypeArguments

  if (args === undefined)
    throw new Error('Record must have type arguments')

  const elements = args.map(arg => convertTypeToIoTsType(arg, namespace, typeChecker))

  return getMethodCall(namespace, 'record', elements)
}


/**
 * Converts Array or ReadonlyArray types to io-ts type entity
 */

function convertArrayToIoTs(type: ts.GenericType, namespace: string, typeChecker: ts.TypeChecker): ts.Expression {

  const arrayType = type.getSymbol()?.escapedName === 'ReadonlyArray' ? 'readonlyArray' : 'array'

  const args = type.typeArguments

  if (args === undefined)
    throw new Error('Array must have type arguments')

  const element = convertTypeToIoTsType(args[0], namespace, typeChecker)

  return getMethodCall(namespace, arrayType, [element])
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
 * Converts Array of object properties to io-ts entity. If there are
 * readonly or optional properties, they will be built as separate
 * objects and mixed to main object using t.intersection function
 */

function convertObjectToIoTs(props: ts.Symbol[], namespace: string, typeChecker: ts.TypeChecker): ts.Expression {

  if (props.length === 0)
    return ts.createObjectLiteral([])

  // separate properties by two
  // criteria (readonly, optional)
  // and get four property lists
  // for each criteria combination

  const readonlyProps: Array<ts.Symbol> = []
  const editableProps: Array<ts.Symbol> = []

  props.forEach(prop => {
    if (isReadonlyPropertyDeclaration(prop))
      readonlyProps.push(prop)
    else editableProps.push(prop)
  })

  const readonlyOptionalProps: Array<ts.Symbol> = []
  const readonlyNonOptionalProps: Array<ts.Symbol> = []

  readonlyProps.forEach(prop => {
    if (isOptionalPropertyDeclaration(prop))
      readonlyOptionalProps.push(prop)
    else readonlyNonOptionalProps.push(prop)
  })

  const editableOptionalProps: Array<ts.Symbol> = []
  const editableNonOptionalProps: Array<ts.Symbol> = []

  editableProps.forEach(prop => {
    if (isOptionalPropertyDeclaration(prop))
      editableOptionalProps.push(prop)
    else editableNonOptionalProps.push(prop)
  })

  // Just works (but I'm not sure of that) :)
  const buildAssignment = (prop: ts.Symbol): ts.PropertyAssignment => {

    const origin = (prop as any).syntheticOrigin

    if (origin !== undefined)
      return buildAssignment(origin)

    const declaration = prop.valueDeclaration

    const t = (declaration !== undefined)
      ? typeChecker.getTypeFromTypeNode((declaration as any).type)
      : (prop as any).type

    const type = convertTypeToIoTsType(t, namespace, typeChecker)

    const name = String(prop.escapedName)

    return ts.createPropertyAssignment(name, type)
  }

  // Builds io-ts t.type (or t.partial) entity by property list
  const handlePropList = (props: ts.Symbol[], isPartial: boolean = false) => getMethodCall(
    namespace, isPartial ? 'partial' : 'type', [ts.createObjectLiteral(props.map(buildAssignment))]
  )

  // Build 4 (or less) objects for each
  // (+-readonly and +-optional) case
  // and add it to the result array
  const result = []

  if (readonlyOptionalProps.length !== 0)
    result.push(getMethodCall(namespace, 'readonly', [handlePropList(readonlyOptionalProps, true)]))

  if (readonlyNonOptionalProps.length !== 0)
    result.push(getMethodCall(namespace, 'readonly', [handlePropList(readonlyNonOptionalProps)]))

  if (editableOptionalProps.length !== 0)
    result.push(handlePropList(editableOptionalProps, true))

  if (editableNonOptionalProps.length !== 0)
    result.push(handlePropList(editableNonOptionalProps))

  // If we have just one object, we don't
  // need to create intersection instance
  if (result.length === 1)
    return result[0]

  return getMethodCall(namespace, 'intersection', [ts.createArrayLiteral(result)])
}


/**
 * Converts ts.Iterator<T> to Array<T> type
 */

function iteratorToArray<T>(iterator: ts.Iterator<T>): Array<T> {

  const handleNext = (result: Array<T>): Array<T> => {

    const next = iterator.next()

    if (next.done)
      return result

    return handleNext([...result, next.value])
  }

  return handleNext([])
}


/**
 * Checks is ts.ObjectType being a lambda expression
 */

function isLambdaExpression(type: ts.ObjectType): boolean {

  return type.getCallSignatures().length !== 0
}


/**
 * Converts ts.Type entity to io-ts type entity
 */

function convertTypeToIoTsType(type: ts.Type, namespace: string, typeChecker: ts.TypeChecker): ts.Expression {

  const stringType = typeChecker.typeToString(type)

  if (stringType === 'never')
    throw new Error('Never type transformation is not supported')

  if (type.isClassOrInterface())
    throw new Error('Transformation of classes interfaces is not supported now.')

  if (type.isUnion()) {

    const types = type.types.map(t => convertTypeToIoTsType(t, namespace, typeChecker))

    return getMethodCall(namespace, 'union', [ts.createArrayLiteral(types)])
  }

  if (['null', 'undefined', 'void', 'unknown'].includes(stringType))
    return getPropertyAccess(namespace, stringType)

  if (stringType === 'false' || stringType === 'true')
    return getMethodCall(namespace, 'literal', [stringType === 'false' ? ts.createFalse() : ts.createTrue()])

  if (type.isStringLiteral())
    return getMethodCall(namespace, 'literal', [ts.createStringLiteral(type.value)])

  if (type.isNumberLiteral())
    return getMethodCall(namespace, 'literal', [ts.createNumericLiteral(type.value.toString())])

  if (['string', 'number', 'boolean'].includes(stringType))
    return getPropertyAccess(namespace, stringType)

  if (isTupleType(type, typeChecker))
    return convertTupleToIoTs(type, namespace, typeChecker)

  if (isArrayType(type, typeChecker))
    return convertArrayToIoTs(type, namespace, typeChecker)

  if (isRecordType(type))
    return convertRecordToIoTs(type, namespace, typeChecker)

  if (isObjectType(type))
    if (isLambdaExpression(type))
      return getPropertyAccess(namespace, 'function')
    else return convertObjectToIoTs(type.getProperties(), namespace, typeChecker)

  // if (type.isClassOrInterface()) {

  //   const { members } = type.symbol

  //   if (members === undefined)
  //     return ts.createObjectLiteral([])

  //   return convertObjectToIoTs(iteratorToArray(members.values()), namespace, typeChecker)
  // }

  return getPropertyAccess(namespace, 'function')
}


/**
 * Removes node if it is index.js import and replaces
 * buildDecoder function call with io-ts type entity
 */

function getNodeVisitor(ioTsInstanceName: string): MappingFunction

function getNodeVisitor(ioTsInstanceName: string) {

  return (node: ts.Node, program: ts.Program) => {

    if (isIndexJsImport(node))
      return undefined

    const typeChecker = program.getTypeChecker()

    if (!isFunctionCallExpression(functionName, indexTsPath)(typeChecker)(node))
      return node

    if (node.typeArguments === undefined)
      throw new Error(`Please pass a type argument to the ${functionName} function`)

    const type = typeChecker.getTypeFromTypeNode(node.typeArguments[0])

    return convertTypeToIoTsType(type, ioTsInstanceName, typeChecker)
  }
}
