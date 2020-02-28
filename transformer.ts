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

  let messageShown = false

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
    if (!messageShown) {

      console.log(`[io-ts-transformer info]: if you will get any problems using this transformer, please
      leave an issue on GitHub https://github.com/awerlogus/io-ts-transformer/issues with your types example`)

      messageShown = true
    }

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
 * Represents result of type transformation.
 * 'Recursions' property is a record where keys are ids
 * of types contains recursion and values are results of
 * its transformations. They must be represented
 * as constants later. NodeResult is expression that
 * represents value of transformed type (literal or constant
 * reference for recursive type cases). Tasks property
 * contains ids of types must be passed to recursions
 * property higher up the call stack.
 */

type TransformationResult<T extends ts.Expression = ts.Expression> = {
  recursions: Record<number, ts.Expression>
  tasks: number[]
  nodeResult: T
}


/**
 * Represents result of types array transformation.
 * 'Recursions' property is a record where keys are ids
 * of types contains recursion and values are results of
 * its transformations. They must be represented
 * as constants later. NodesResult is array of expressions that
 * represents values of transformed types (literal or constant
 * references for recursive type cases). Tasks property
 * contains ids of types must be passed to recursions
 * property higher up the call stack.
 */

type TypeArrayTransformationResult<T extends ts.Expression = ts.Expression> = {
  recursions: Record<number, ts.Expression>
  tasks: number[],
  nodesResult: T[]
}

/**
 * Stack represents list of type ids of current call stack.
 * Recursions prop contains list of recursive type ids that were
 * already computed and may be replaced with constant reference.
 */

type TransformationData = {
  stack: number[]
  recursions: number[]
}


/**
 * Returns id of ts.Type
 */

function getTypeId(type: ts.Type): number {

  return (type as any).id
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
 * Returns keys of object where keys are numbers
 */

function getNumberObjectKeys<T>(object: Record<number, T>): number[] {

  return Object.keys(object).map(num => parseInt(num))
}


/**
 * Converts an array of types to io-ts entities
 * every next type transformation of array knows
 * about previous transformation results.
 * Especially it knows about ids of other
 * recursive types that were transformed during
 * transforming previous array elements and so it
 * should be just replaced by constant reference
 */

function convertTypesArray(
  types: readonly ts.Type[], namespace: string, typeChecker: ts.TypeChecker, data: TransformationData
): TypeArrayTransformationResult {

  const convertNextType = (
    types: readonly ts.Type[], data: TransformationData, result: TransformationResult[]
  ): TransformationResult[] => {

    const [head, ...tail] = types

    const res = convertTypeToIoTs(head, namespace, typeChecker, data)

    const recursionIds = mergeArrays(data.recursions, getNumberObjectKeys(res.recursions))

    const newResult = [...result, res]

    if (tail.length === 0)
      return newResult

    return convertNextType(tail, {
      recursions: mergeArrays(recursionIds, res.tasks),
      stack: data.stack
    }, newResult)
  }

  const result = convertNextType(types, data, [])

  const tasks = result.map(res => res.tasks).reduce(mergeArrays)

  const recursions = result.map(res => res.recursions).reduce(mergeObjects)

  const nodesResult = result.map(res => res.nodeResult)

  return { nodesResult, recursions, tasks }
}


/**
 * Converts ts.UnionType to io-ts TransformationResult
 */

function convertUnionType(
  type: ts.UnionType, namespace: string, typeChecker: ts.TypeChecker, data: TransformationData
): TransformationResult {

  const nodes = type.aliasSymbol?.declarations

  const types = nodes !== undefined && nodes.length !== 0
    ? (nodes[0] as any).type.types.map(typeChecker.getTypeFromTypeNode)
    : type.types

  const result = convertTypesArray(types, namespace, typeChecker, data)

  const nodeResult = getMethodCall(namespace, 'union', [ts.createArrayLiteral(result.nodesResult)])

  return { ...result, nodeResult }
}


/**
 * Converts ts.TupleType to io-ts TransformationResult
 */

function convertTupleType(
  type: ts.TupleType, namespace: string, typeChecker: ts.TypeChecker, data: TransformationData
): TransformationResult {

  const result = convertTypesArray((type as any).resolvedTypeArguments, namespace, typeChecker, data)

  const nodeResult = getMethodCall(namespace, 'tuple', [ts.createArrayLiteral(result.nodesResult)])

  return { ...result, nodeResult }
}


/**
 * Converts Array or ReadonlyArray types to io-ts TransformationResult
 */

function convertArrayType(
  type: ts.GenericType, namespace: string, typeChecker: ts.TypeChecker, data: TransformationData
): TransformationResult {

  const arrayType = type.getSymbol()?.escapedName === 'ReadonlyArray' ? 'readonlyArray' : 'array'

  const args = type.typeArguments

  if (args === undefined || args.length === 0)
    throw new Error('Array must have type arguments')

  const result = convertTypeToIoTs(args[0], namespace, typeChecker, data)

  const nodeResult = getMethodCall(namespace, arrayType, [result.nodeResult])

  return { ...result, nodeResult }
}


/**
 * Converts Record type to to io-ts TransformationResult
 */

function convertRecordType(
  type: ts.GenericType, namespace: string, typeChecker: ts.TypeChecker, data: TransformationData
): TransformationResult {

  const args = type.aliasTypeArguments

  if (args === undefined)
    throw new Error('Record must have type arguments')

  const result = convertTypesArray(args, namespace, typeChecker, data)

  const nodeResult = getMethodCall(namespace, 'record', result.nodesResult)

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
 * Converts Array of object properties to io-ts TransformationResult. If there are
 * readonly or optional properties, they will be built as separate
 * objects and mixed to main object using t.intersection function
 */

function convertObjectType(
  props: ts.Symbol[], namespace: string, typeChecker: ts.TypeChecker, data: TransformationData
): TransformationResult {

  if (props.length === 0)
    return { nodeResult: ts.createObjectLiteral([]), recursions: {}, tasks: [] }

  const preparedProps = props.map(prop => {

    const origin = (prop as any).syntheticOrigin

    return origin !== undefined ? origin : prop
  })

  // separate properties by two
  // criteria (readonly, optional)
  // and get four property lists
  // for each criteria combination

  const readonlyProps: Array<ts.Symbol> = []
  const editableProps: Array<ts.Symbol> = []

  preparedProps.forEach(prop => {
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

  // Extracts property type and name from ts.Symbol
  const extractProperty = (prop: ts.Symbol): { name: string, type: ts.Type } => {

    const declaration = prop.valueDeclaration

    const type = (declaration !== undefined)
      ? typeChecker.getTypeFromTypeNode((declaration as any).type)
      : (prop as any).type

    const name = String(prop.escapedName)

    return { name, type }
  }

  // Builds io-ts t.type (or t.partial) entity by property list
  const handlePropList = (props: ts.Symbol[], isPartial: boolean, data: TransformationData) => {

    const handledProps = props.map(extractProperty)

    const types = handledProps.map(prop => prop.type)

    const result = convertTypesArray(types, namespace, typeChecker, data)

    const properties = result.nodesResult.map((p, i) => ts.createPropertyAssignment(handledProps[i].name, p))

    const objectType = isPartial ? 'partial' : 'type'

    const nodeResult = getMethodCall(namespace, objectType, [ts.createObjectLiteral(properties)])

    return { ...result, nodeResult }
  }

  // Build 4 (or less) objects for each
  // (+-readonly and +-optional) case
  // and add it to the result array
  const result: TransformationResult[] = []

  const newData = data

  if (readonlyOptionalProps.length !== 0) {

    const res = handlePropList(readonlyOptionalProps, true, newData)

    newData.recursions = mergeArrays(newData.recursions, getNumberObjectKeys(res.recursions))

    newData.recursions = mergeArrays(newData.recursions, res.tasks)

    const nodeResult = getMethodCall(namespace, 'readonly', [res.nodeResult])

    result.push({ ...res, nodeResult })
  }

  if (readonlyNonOptionalProps.length !== 0) {

    const res = handlePropList(readonlyNonOptionalProps, false, newData)

    newData.recursions = mergeArrays(newData.recursions, getNumberObjectKeys(res.recursions))

    newData.recursions = mergeArrays(newData.recursions, res.tasks)

    const nodeResult = getMethodCall(namespace, 'readonly', [res.nodeResult])

    result.push({ ...res, nodeResult })
  }

  if (editableOptionalProps.length !== 0) {

    const res = handlePropList(editableOptionalProps, true, newData)

    newData.recursions = mergeArrays(newData.recursions, getNumberObjectKeys(res.recursions))

    newData.recursions = mergeArrays(newData.recursions, res.tasks)

    result.push(res)
  }

  if (editableNonOptionalProps.length !== 0)
    result.push(handlePropList(editableNonOptionalProps, false, newData))

  const recursions = result.map(res => res.recursions).reduce(mergeObjects)

  const tasks = result.map(res => res.tasks).reduce(mergeArrays)

  const nodeResult = result.length !== 1
    ? getMethodCall(namespace, 'intersection', [
      ts.createArrayLiteral(result.map(res => res.nodeResult))
    ])
    : result[0].nodeResult

  return { recursions, tasks, nodeResult }
}


/**
 * Checks is ts.Type being a function
 */

function isFunction(type: ts.Type): boolean {

  return type.getCallSignatures().length !== 0
}


/**
 * Builds TransformationResult for literal cases
 */

function getLiteralTransformationResult(namespace: string, literal: ts.Expression): TransformationResult {

  const model = getMethodCall(namespace, 'literal', [literal])

  return { nodeResult: model, recursions: {}, tasks: [] }
}


/**
 * Builds TransformationResult for basic type cases
 */

function getBasicTypeTransformationResult(namespace: string, typeName: string): TransformationResult {

  return { nodeResult: getPropertyAccess(namespace, typeName), recursions: {}, tasks: [] }
}


/**
 * Converts ts.Type entity to io-ts TransformationResult
 */

function convertTypeToIoTs(
  type: ts.Type, namespace: string, typeChecker: ts.TypeChecker, data: TransformationData
): TransformationResult {

  const stringType = typeChecker.typeToString(type)

  // Checking for error cases
  if (stringType === 'never')
    throw new Error('Never type transformation is not supported')

  if (type.isClassOrInterface())
    throw new Error('Transformation of classes interfaces is not supported now')

  // Non recursive types
  if (['null', 'undefined', 'void', 'unknown'].includes(stringType))
    return getBasicTypeTransformationResult(namespace, stringType)

  if (stringType === 'true' || stringType === 'false') {

    const literal = stringType === 'true' ? ts.createTrue() : ts.createFalse()

    return getLiteralTransformationResult(namespace, literal)
  }

  if (type.isStringLiteral())
    return getLiteralTransformationResult(namespace, ts.createStringLiteral(type.value))

  if (type.isNumberLiteral())
    return getLiteralTransformationResult(namespace, ts.createNumericLiteral(type.value.toString()))

  if (['string', 'number', 'boolean'].includes(stringType))
    return getBasicTypeTransformationResult(namespace, stringType)

  if (isFunction(type))
    return getBasicTypeTransformationResult(namespace, 'function')

  // Checking for the stack loop
  const typeId = getTypeId(type)

  const recursionsIncludes = data.recursions.includes(typeId)

  if (recursionsIncludes || data.stack.includes(typeId))
    return {
      nodeResult: ts.createIdentifier(generateNodeName(typeId)),
      tasks: recursionsIncludes ? [] : [typeId],
      recursions: {},
    }

  // Recursive types
  const newData = { ...data, stack: [...data.stack, typeId] }

  let result: TransformationResult

  if (type.isUnion())
    result = convertUnionType(type, namespace, typeChecker, newData)

  else if (isTupleType(type, typeChecker))
    result = convertTupleType(type, namespace, typeChecker, newData)

  else if (isArrayType(type, typeChecker))
    result = convertArrayType(type, namespace, typeChecker, newData)

  else if (isRecordType(type))
    result = convertRecordType(type, namespace, typeChecker, newData)

  else if (isObjectType(type))
    result = convertObjectType(type.getProperties(), namespace, typeChecker, newData)

  else result = getBasicTypeTransformationResult(namespace, 'void')

  // Check if we need to enrich recursions property with this type
  const hasTask = result.tasks.includes(typeId)

  const nodeResult = hasTask ? ts.createIdentifier(generateNodeName(typeId)) : result.nodeResult

  const newRecursion = hasTask ? { [typeId]: result.nodeResult } : {}

  const recursions = [result.recursions, newRecursion].reduce(mergeObjects)

  const tasks = hasTask ? result.tasks.filter(id => id !== typeId) : result.tasks

  return { nodeResult, recursions, tasks }
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

function getSimpleArrowFunction(body: ts.Expression | ts.Block): ts.ArrowFunction {

  return ts.createArrowFunction(
    undefined, undefined, [], undefined,
    ts.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    body
  )
}


/**
 * Wraps ts.Expression into t.recursion
 */

function getRecursiveTypeModel(namespace: string, name: string, model: ts.Expression): ts.VariableStatement {

  const recursion = getMethodCall(namespace, 'recursion', [
    ts.createStringLiteral(name),
    getSimpleArrowFunction(model)
  ])

  return createConstant(name, recursion)
}


/**
 * Generates name for node constant by its id
 */

function generateNodeName(id: number): string {

  return `node${id}`
}


/**
 * Converts ts.Type entity to io-ts type entity
 */

function convertTypeToIoTsType(type: ts.Type, namespace: string, typeChecker: ts.TypeChecker): ts.Expression {

  const initialData: TransformationData = { recursions: [], stack: [] }

  const data = convertTypeToIoTs(type, namespace, typeChecker, initialData)

  const { recursions, nodeResult } = data

  const ids = getNumberObjectKeys(recursions)

  if (ids.length === 0)
    return nodeResult

  const constants = ids.map(id => getRecursiveTypeModel(namespace, generateNodeName(id), recursions[id]))

  const iifeBlock = ts.createBlock([...constants, ts.createReturn(nodeResult)], true)

  return ts.createCall(ts.createParen(getSimpleArrowFunction(iifeBlock)), undefined, [])
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

    const typeArguments = node.typeArguments

    if (typeArguments === undefined || typeArguments.length === 0)
      throw new Error(`Please pass a type argument to the ${functionName} function`)

    const type = typeChecker.getTypeFromTypeNode(typeArguments[0])

    return convertTypeToIoTsType(type, ioTsInstanceName, typeChecker)
  }
}
