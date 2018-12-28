'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as pathparse from 'path';

import { MooseFileStruct } from './moose_filestruct';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    console.log('Activated MOOSE for VSCode extension');

    var moose_selector = { scheme: 'file', language: "moose" };

    // Initialise MOOSE objects DB
    var moose_objects = new MooseFileStruct();

    // allow manual reset of MOOSE objects DB
    context.subscriptions.push(
        vscode.commands.registerCommand('moose.ResetMooseObjects', () => {
            moose_objects.resetMooseObjects();
    }));

    // Keep MOOSE objects DB up-to-date
    let config_change = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('moose')) {moose_objects.resetMooseObjects();}
    });
    context.subscriptions.push(config_change);
    let workspace_change = vscode.workspace.onDidChangeWorkspaceFolders(event => {moose_objects.resetMooseObjects();});
    context.subscriptions.push(workspace_change);
    let fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**', false, false, false);
    context.subscriptions.push(fileSystemWatcher.onDidCreate((filePath) => {
        moose_objects.addMooseObject(filePath);
    }));
    context.subscriptions.push(fileSystemWatcher.onDidChange((filePath) => {
        moose_objects.removeMooseObject(filePath);
        moose_objects.addMooseObject(filePath);
    }));
    context.subscriptions.push(fileSystemWatcher.onDidDelete((filePath) => {
        moose_objects.removeMooseObject(filePath);
    }));

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            moose_selector, new CompletionItemProvider(moose_objects), "[", "="));

    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            moose_selector, new DocumentSymbolProvider()));

    context.subscriptions.push(
        vscode.languages.registerReferenceProvider(
            moose_selector, new ReferenceProvider()));

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            moose_selector, new DefinitionProvider(moose_objects)));

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            moose_selector, new HoverProvider(moose_objects)));

}

// this method is called when your extension is deactivated
export function deactivate() {
}

class DefinitionProvider implements vscode.DefinitionProvider {

    private moose_objects: MooseFileStruct;
    constructor(moose_objects: MooseFileStruct) {
        this.moose_objects = moose_objects;
    }
    
    public provideDefinition(
        document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken):
        Thenable<vscode.Location> {
        return this.doFindDefinition(document, position, token);
    }
    
    private doFindDefinition(
        document: vscode.TextDocument, position: vscode.Position,
        token: vscode.CancellationToken): Thenable<vscode.Location> {
        return new Promise<vscode.Location>((resolve, reject) => {
            
            let wordRange = document.getWordRangeAtPosition(position);

            // ignore if empty
            if (!wordRange) {
                //TODO how to show error message at cursor position?
                vscode.window.showWarningMessage("empty string not definable");
                reject("empty string not definable");
                return;
            }

            let word_text = document.getText(wordRange);
            let obj_dict = this.moose_objects.getMooseObjectsDict();

            if (word_text in obj_dict) {
                var location = new vscode.Location(
                    obj_dict[word_text],
                    new vscode.Position(0, 0));
                resolve(location);
            } else {
                reject("could not find declaration");
            }

        });
    }
}

class HoverProvider implements vscode.HoverProvider {

    private moose_objects: MooseFileStruct;
    constructor(moose_objects: MooseFileStruct) {
        this.moose_objects = moose_objects;
    }

    public provideHover(
        document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken):
        Thenable<vscode.Hover> {
        return this.doFindDefinition(document, position, token);
    }

    private doFindDefinition(
        document: vscode.TextDocument, position: vscode.Position,
        token: vscode.CancellationToken): Thenable<vscode.Hover> {
        return new Promise<vscode.Hover>((resolve, reject) => {

            if (!document.lineAt(position.line).text.trim().match("type*=*")) {
                reject('no definition available');
                return;
            }

            let wordRange = document.getWordRangeAtPosition(position);

            // ignore if empty
            if (!wordRange) {
                reject("empty string not definable");
                return;
            }
            let word_text = document.getText(wordRange);
            if (word_text === "type" || word_text === "=" || word_text === "") {
                reject('no definition available');
                return;
            }

            let moose_dict = this.moose_objects.getMooseObjectsDict();

            if (word_text in moose_dict) {
                const uri = moose_dict[word_text];

                let thenable = this.moose_objects.createDescription(uri);

                thenable.then(
                    descript => {
                        if (descript === null){
                            // reject('no definition description available');
                            const results = new vscode.Hover("No Class Description Available");
                            resolve(results);
                        } else {
                            let mkdown = new vscode.MarkdownString(descript); // "**"+word_text+"**:\n"+descript
                            const results = new vscode.Hover(mkdown);
                            resolve(results);
                        }        
                    }
                );                

            } else {
                // reject('no definition description available');
                const results = new vscode.Hover("No Class Description Available");
                resolve(results);
            }

        });
    }
}

// TODO implement change all occurences reference names; difficult because would have to account for when they are used in functions, etc

class ReferenceProvider implements vscode.ReferenceProvider {
    public provideReferences(
        document: vscode.TextDocument, position: vscode.Position,
        options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
        return this.doFindReferences(document, position, options, token);
    }

    private doFindReferences(
        document: vscode.TextDocument, position: vscode.Position,
        options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
        return new Promise<vscode.Location[]>((resolve, reject) => {
            // get current word
            let wordRange = document.getWordRangeAtPosition(position);

            // ignore if empty
            if (!wordRange) {
                //TODO how to show error message at cursor position?
                // vscode.window.showWarningMessage("empty string not referencable");
                // console.log("empty string not referencable");
                reject("empty string not referencable");

            }
            let word_text = document.getText(wordRange);

            // ignore if is a number
            if (!isNaN(Number(word_text))) {
                // return resolve([]);
                //TODO how to show error message at cursor position?
                // vscode.window.showWarningMessage("numbers are not referencable");
                // console.log("numbers are not referencable");
                reject("numbers are not referencable");

            }

            let results: vscode.Location[] = [];
            let in_variables = false;

            for (var i = 0; i < document.lineCount; i++) {
                var line = document.lineAt(i);

                // remove comments
                var line_text = line.text.trim().split("#")[0].trim();

                // reference variable instatiation in [Variables] block e.g. [./c]
                if (line_text === "[Variables]" || line_text === "[AuxVariables]") {
                    in_variables = true;
                }
                if (line_text === "[]") {
                    in_variables = false;
                }
                if (in_variables && line_text === "[./" + word_text + "]") {
                    results.push(new vscode.Location(document.uri, line.range));
                    continue;
                }

                // TODO account for if quoted string is continued over multiple lines

                // get right side of equals
                if (!line_text.includes("=")) {
                    continue;
                }
                var larray = line_text.split("=");
                if (larray.length < 2) {
                    continue;
                }
                var equals_text = larray[1].trim();

                // remove quotes
                if (equals_text.startsWith("'") && equals_text.endsWith("'")) {
                    equals_text = equals_text.substr(1, equals_text.length - 2);
                }
                if (equals_text.startsWith('"') && equals_text.endsWith('"')) {
                    equals_text = equals_text.substr(1, equals_text.length - 2);
                }

                // test if only reference
                if (equals_text === word_text) {
                    results.push(new vscode.Location(document.uri, line.range));
                } else {
                    // test if one of many references
                    for (let elem of equals_text.split(" ")) {
                        if (elem.trim() === word_text) {
                            results.push(new vscode.Location(document.uri, line.range));
                            break;
                        }
                    }
                }
                // TODO find reference when used in a function

            }
            resolve(results);
        });
    }
}

class CompletionItemProvider implements vscode.CompletionItemProvider {

    private moose_objects: MooseFileStruct;
    private moose_blocks: string[];
    constructor(moose_objects: MooseFileStruct) {
        this.moose_objects = moose_objects;
        this.moose_blocks = [
            "GlobalParams",
            "Variables",
            "AuxVariables",
            "Mesh",
            "BCs",
            "ICs",
            "Problem",
            "Precursors",
            "Kernels",
            "AuxKernels",
            "Functions",
            "Materials",
            "Executioner",
            "Preconditioning",
            "Outputs"
        ];

    }

    public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {

        var completions = [];

        // Block name completions after square bracket
        var before_sbracket = false;
        if (position.character !== 0) {
            var char = document.getText(new vscode.Range(position.translate(0, -1), position));
            if (char === "[") {
                before_sbracket = true;
            }
        }
        if (before_sbracket) {
            for (let bname of this.moose_blocks) {
                completions.push(new vscode.CompletionItem(bname, vscode.CompletionItemKind.Field));
            }
            completions.push(new vscode.CompletionItem("./"));
            completions.push(new vscode.CompletionItem("../"));
        }

        // MOOSE object name completions after 'type ='
        if (document.lineAt(position.line).text.trim().match("type*=*")) {
            // TODO MOOSE objects autocomplete could also be based on current block
            let moose_list = this.moose_objects.getMooseObjectsList();
            for (let uri of moose_list) {
                var path = pathparse.parse(uri.fsPath);
                let citem = new vscode.CompletionItem(" " + path.name, vscode.CompletionItemKind.Class);
                citem.detail = uri.fsPath; // this is at the top
                let descript = this.moose_objects.getDescription(uri);
                if (descript !== null){
                    citem.documentation = descript; // this is at the bottom
                }
                completions.push(citem);
            }
        }

        // new vscode.CompletionItem("active = ''"),  
        // TODO if `active` present in block, dim out non-active sub-blocks or action to fold them?

        return completions;
    }

}

class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    public provideDocumentSymbols(document: vscode.TextDocument,
        token: vscode.CancellationToken): Thenable<vscode.SymbolInformation[]> {
        return new Promise((resolve, reject) => {
            var symbols = [];
            var head1_regex = new RegExp('\\[[_a-zA-Z0-9]+\\]');
            var head2_regex = new RegExp('\\[\\.\\/[_a-zA-Z0-9]+\\]');
            var in_variables = false;
            var kind = null;

            for (var i = 0; i < document.lineCount; i++) {
                var line = document.lineAt(i);

                // remove comments
                var text = line.text.trim().split("#")[0].trim();

                if (head1_regex.test(text)) {

                    // Check if in variables block
                    if (text.substr(1, text.length - 2).match('Variables') || text.substr(1, text.length - 2).match('AuxVariables')) {
                        in_variables = true;
                    } else {
                        in_variables = false;
                    }

                    // Find the closing []
                    var last_line = line;
                    for (var j = i; j < document.lineCount; j++) {
                        var line2 = document.lineAt(j);
                        var text2 = line2.text.trim();
                        if (text2 === "[]") {
                            last_line = line2;
                            break;
                        }
                    }

                    symbols.push({
                        name: text.substr(1, text.length - 2),
                        containerName: "Main Block",
                        kind: vscode.SymbolKind.Field,
                        location: new vscode.Location(document.uri,
                            new vscode.Range(new vscode.Position(line.lineNumber, 1),
                                new vscode.Position(last_line.lineNumber, last_line.text.length)))
                    });
                }
                if (head2_regex.test(text)) {

                    // Find the closing [../]
                    var last_line2 = line;
                    for (var k = i; k < document.lineCount; k++) {
                        var line3 = document.lineAt(k);
                        var text3 = line3.text.trim();
                        if (text3 === "[../]") {
                            last_line2 = line3;
                            break;
                        }
                    }

                    if (in_variables) {
                        kind = vscode.SymbolKind.Variable;
                    } else {
                        kind = vscode.SymbolKind.String;
                    }

                    symbols.push({
                        name: text.substr(3, text.length - 4),
                        containerName: "Sub Block",
                        kind: kind,
                        location: new vscode.Location(document.uri,
                            new vscode.Range(new vscode.Position(line.lineNumber, 1),
                                new vscode.Position(last_line2.lineNumber, last_line2.text.length)))
                    });
                }
            }

            resolve(symbols);
        });
    }
}


// TODO move to DocumentSymbol API: https://code.visualstudio.com/updates/v1_25#_document-symbols
// Like this (although this isn't working)
// class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {
//     public provideDocumentSymbols(document: vscode.TextDocument,
//             token: vscode.CancellationToken): Thenable<vscode.DocumentSymbol[]> {
//         return new Promise((resolve, reject) => {
//             var symbols = [];
//             var head1_regex = new RegExp('\\[[a-zA-Z0-9]+\\]');
//             var head2_regex = new RegExp('\\[\\.\\/[a-zA-Z0-9]+\\]');
//             for (var i = 0; i < document.lineCount; i++) {
//                 var line = document.lineAt(i);
//                 var text = line.text.trim();
//                 // if (line.text.startsWith("[")) {
//                 if (head1_regex.test(text)) {
//                     // var location = new vscode.Location(document.uri, line.range)
//                     symbols.push({
//                         name: text.substr(1, text.length-2),
//                         detail: "Main Module",
//                         kind: vscode.SymbolKind.String,
//                         range: new vscode.Range(new vscode.Position(line.lineNumber, 1), 
//                                                 new vscode.Position(line.lineNumber, line.text.length)),
//                         selectionRange: new vscode.Range(new vscode.Position(line.lineNumber, 1), 
//                                                 new vscode.Position(line.lineNumber, line.text.length)),
//                         children: []
//                     });
//                 }
//                 if (head2_regex.test(text)) {
//                     symbols.push({
//                         name: text.substr(3, text.length-4),
//                         detail: "Submodule",
//                         kind: vscode.SymbolKind.String,
//                         range: new vscode.Range(new vscode.Position(line.lineNumber, 1), 
//                                                 new vscode.Position(line.lineNumber, line.text.length)),
//                         selectionRange: new vscode.Range(new vscode.Position(line.lineNumber, 1), 
//                                                 new vscode.Position(line.lineNumber, line.text.length)),
//                         children: []
//                     });
//                 }
//            }
//             resolve(symbols);
//         });
//     }
// }