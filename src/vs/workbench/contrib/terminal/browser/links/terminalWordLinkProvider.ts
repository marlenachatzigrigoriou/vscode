/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Terminal, IViewportRange, IBufferLine } from 'xterm';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ITerminalConfiguration, TERMINAL_CONFIG_SECTION } from 'vs/workbench/contrib/terminal/common/terminal';
import { TerminalLink } from 'vs/workbench/contrib/terminal/browser/links/terminalLink';
import { localize } from 'vs/nls';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ISearchService } from 'vs/workbench/services/search/common/search';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { QueryBuilder } from 'vs/workbench/contrib/search/common/queryBuilder';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { XtermLinkMatcherHandler } from 'vs/workbench/contrib/terminal/browser/links/terminalLinkManager';
import { TerminalBaseLinkProvider } from 'vs/workbench/contrib/terminal/browser/links/terminalBaseLinkProvider';
import { normalize } from 'vs/base/common/path';

export class TerminalWordLinkProvider extends TerminalBaseLinkProvider {
	private readonly _fileQueryBuilder = this._instantiationService.createInstance(QueryBuilder);

	constructor(
		private readonly _xterm: Terminal,
		private readonly _wrapLinkHandler: (handler: (event: MouseEvent | undefined, link: string) => void) => XtermLinkMatcherHandler,
		private readonly _tooltipCallback: (link: TerminalLink, viewportRange: IViewportRange, modifierDownCallback?: () => void, modifierUpCallback?: () => void) => void,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ISearchService private readonly _searchService: ISearchService,
		@IEditorService private readonly _editorService: IEditorService
	) {
		super();
	}

	protected _provideLinks(y: number): TerminalLink[] {
		// Dispose of all old links if new links are provided, links are only cached for the current line
		const result: TerminalLink[] = [];
		const wordSeparators = this._configurationService.getValue<ITerminalConfiguration>(TERMINAL_CONFIG_SECTION).wordSeparators;
		const activateCallback = this._wrapLinkHandler((_, link) => this._activate(link));
		let startLine = y - 1;
		let endLine = y;
		let text = '';
		let startX = -1;

		const lines: IBufferLine[] = [
			this._xterm.buffer.active.getLine(startLine)!
		];
		while (startLine >= 0 && this._xterm.buffer.active.getLine(startLine)?.isWrapped) {
			lines.unshift(this._xterm.buffer.active.getLine(startLine - 1)!);
			startLine--;
		}

		while (endLine < this._xterm.buffer.active.length && this._xterm.buffer.active.getLine(endLine + 1)?.isWrapped) {
			lines.push(this._xterm.buffer.active.getLine(endLine + 1)!);
			endLine++;
		}

		for (let i = startLine; i < endLine; i++) {
			let line = this._xterm.buffer.active.getLine(i)!;
			let cellData = line.getCell(0)!;
			for (let x = 0; x < line.length; x++) {
				line.getCell(x, cellData);
				const chars = cellData.getChars();
				const width = cellData.getWidth();

				// Add a link if this is a separator
				if (width !== 0 && wordSeparators.indexOf(chars) >= 0 && i === endLine - 1) {
					if (startX !== -1) {
						result.push(this._createTerminalLink(startX, x, endLine, text, activateCallback));
						text = '';
						startX = -1;
					}
					continue;
				}

				// Mark the start of a link if it hasn't started yet
				if (startX === -1) {
					startX = x;
				}

				text += chars;
			}

			// Add the final link if there is one
			if (startX !== -1 && i === endLine - 1) {
				result.push(this._createTerminalLink(startX, line.length, startLine, text, activateCallback, endLine));
			}
		}
		return result;
	}

	private _createTerminalLink(startX: number, endX: number, y: number, text: string, activateCallback: XtermLinkMatcherHandler, endLine?: number): TerminalLink {
		// Remove trailing colon if there is one so the link is more useful
		if (text.length > 0 && text.charAt(text.length - 1) === ':') {
			text = text.slice(0, -1);
			endX--;
		}
		endLine = endLine ? endLine : y;
		return this._instantiationService.createInstance(TerminalLink,
			this._xterm,
			{ start: { x: startX + 1, y }, end: { x: endX, y: endLine } },
			text,
			this._xterm.buffer.active.viewportY,
			activateCallback,
			this._tooltipCallback,
			false,
			localize('searchWorkspace', 'Search workspace')
		);
	}

	private async _activate(link: string) {
		// Normalize the link and remove any leading ./ or ../ since quick access doesn't understand
		// that format
		link = normalize(link).replace(/^(\.+\/)+/, '');
		const results = await this._searchService.fileSearch(
			this._fileQueryBuilder.file(this._workspaceContextService.getWorkspace().folders, {
				filePattern: link,
				maxResults: 2
			})
		);

		// If there was exactly one match, open it
		if (results.results.length === 1) {
			const match = results.results[0];
			await this._editorService.openEditor({ resource: match.resource, options: { pinned: true } });
			return;
		}

		// Fallback to searching quick access
		this._quickInputService.quickAccess.show(link);
	}
}
