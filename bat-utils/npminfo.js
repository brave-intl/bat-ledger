// import { join, sep } from 'path'
// import { last, pick } from 'underscore'
// const {
//   SERVICE
// } = process.env
// const cwd = process.cwd()
// const parent = join(cwd, '..')
// const parentSplit = parent.split(sep)
// const parentSplitLast = last(parentSplit)
// const notNodeMods = parentSplitLast !== 'node_modules'
// const PACKAGE = 'package'
// const rootNpmInfoPath = notNodeMods ? cwd : join(parent, '..')
// const npmInfoPath = join(rootNpmInfoPath, PACKAGE)
// const npminfo = require(npmInfoPath)
// if (SERVICE) {
//   npminfo.name = 'bat-' + SERVICE
// }
// const attrs = [
//   'name',
//   'version',
//   'description',
//   'author',
//   'license',
//   'bugs',
//   'homepage',
//   'dependencies'
// ]
// export default pick(npminfo, attrs)
