import React, { FormEvent, Fragment, PureComponent } from 'react';
import { autoBindMethodsForReact } from 'class-autobind-decorator';
import { AUTOBIND_CFG, DEBOUNCE_MILLIS } from '../../../common/constants';
import classnames from 'classnames';
import { SortableContainer, SortableElement, arrayMove } from 'react-sortable-hoc/dist/es6';
import { Dropdown, DropdownButton, DropdownItem } from '../base/dropdown';
import PromptButton from '../base/prompt-button';
import Button from '../base/button';
import Link from '../base/link';
import EnvironmentEditor from '../editors/environment-editor';
import Editable from '../base/editable';
import Modal, { ModalProps } from '../base/modal';
import ModalBody from '../base/modal-body';
import ModalHeader from '../base/modal-header';
import ModalFooter from '../base/modal-footer';
import * as models from '../../../models';
import type { Workspace } from '../../../models/workspace';
import type { Environment } from '../../../models/environment';
import { database as db } from '../../../common/database';
import HelpTooltip from '../help-tooltip';
import Tooltip from '../tooltip';
import { docsTemplateTags } from '../../../common/documentation';
import { HandleGetRenderContext, HandleRender } from '../../../common/render';
const ROOT_ENVIRONMENT_NAME = 'Base Environment';

interface Props extends ModalProps {
  handleChangeEnvironment: (id: string | null) => void;
  activeEnvironmentId: string | null;
  editorFontSize: number;
  editorIndentSize: number;
  editorKeyMap: string;
  lineWrapping: boolean;
  render: HandleRender;
  getRenderContext: HandleGetRenderContext;
  nunjucksPowerUserMode: boolean;
  isVariableUncovered: boolean;
}

interface State {
  workspace: Workspace | null;
  isValid: boolean;
  subEnvironments: Array<Environment>;
  rootEnvironment: Environment | null;
  selectedEnvironmentId: string | null;
}

const SidebarListItem = SortableElement(
  ({ environment, activeEnvironment, showEnvironment, changeEnvironmentName }) => {
    const classes = classnames({
      'env-modal__sidebar-item': true,
      'env-modal__sidebar-item--active': activeEnvironment === environment,
      // Specify theme because dragging will pull it out to <body>
      'theme--dialog': true,
    });
    return (
      <li key={environment._id} className={classes}>
        <Button onClick={showEnvironment} value={environment}>
          <i className="fa fa-drag-handle drag-handle" />
          {environment.color ? (
            <i
              className="space-right fa fa-circle"
              style={{
                color: environment.color,
              }}
            />
          ) : (
            <i className="space-right fa fa-empty" />
          )}

          {environment.isPrivate && (
            <Tooltip position="top" message="Environment will not be exported or synced">
              <i className="fa fa-eye-slash faint space-right" />
            </Tooltip>
          )}

          <Editable
            className="inline-block"
            onSubmit={name => changeEnvironmentName(environment, name)}
            value={environment.name}
          />
        </Button>
      </li>
    );
  },
);

const SidebarList = SortableContainer(
  ({ environments, activeEnvironment, showEnvironment, changeEnvironmentName }) => (
    <ul>
      {environments.map((e, i) => (
        <SidebarListItem
          key={e._id}
          environment={e}
          index={i}
          activeEnvironment={activeEnvironment}
          showEnvironment={showEnvironment}
          changeEnvironmentName={changeEnvironmentName}
        />
      ))}
    </ul>
  ),
);

@autoBindMethodsForReact(AUTOBIND_CFG)
class WorkspaceEnvironmentsEditModal extends PureComponent<Props, State> {
  environmentEditorRef: EnvironmentEditor | null = null;
  environmentColorInputRef: HTMLInputElement;
  saveTimeout: NodeJS.Timeout | null = null;
  modal: Modal | null = null;
  editorKey = 0;

  state: State = {
    workspace: null,
    isValid: true,
    subEnvironments: [],
    rootEnvironment: null,
    selectedEnvironmentId: null,
  }

  colorChangeTimeout: NodeJS.Timeout | null = null;

  hide() {
    this.modal?.hide();
  }

  _setEditorRef(n: EnvironmentEditor) {
    this.environmentEditorRef = n;
  }

  _setInputColorRef(ref: HTMLInputElement) {
    this.environmentColorInputRef = ref;
  }

  _setModalRef(n: Modal) {
    this.modal = n;
  }

  async show(workspace: Workspace) {
    const { activeEnvironmentId } = this.props;

    // Default to showing the currently active environment
    if (activeEnvironmentId) {
      this.setState({
        selectedEnvironmentId: activeEnvironmentId,
      });
    }

    await this._load(workspace);
    this.modal && this.modal.show();
  }

  async _load(workspace: Workspace | null, environmentToSelect: Environment | null = null) {
    if (!workspace) {
      console.warn('Failed to reload environment editor without Workspace');
      return;
    }

    const rootEnvironment = await models.environment.getOrCreateForWorkspace(workspace);
    const subEnvironments = await models.environment.findByParentId(rootEnvironment._id);
    let selectedEnvironmentId;

    if (environmentToSelect) {
      selectedEnvironmentId = environmentToSelect._id;
    } else if (this.state.workspace && workspace._id !== this.state.workspace._id) {
      // We've changed workspaces, so load the root one
      selectedEnvironmentId = rootEnvironment._id;
    } else {
      // We haven't changed workspaces, so try loading the last environment, and fall back
      // to the root one
      selectedEnvironmentId = this.state.selectedEnvironmentId || rootEnvironment._id;
    }

    this.setState({
      workspace,
      rootEnvironment,
      subEnvironments,
      selectedEnvironmentId,
    });
  }

  async _handleAddEnvironment(isPrivate = false) {
    const { rootEnvironment, workspace } = this.state;

    if (!rootEnvironment) {
      console.warn('Failed to add environment. Unknown root environment');
      return;
    }

    const parentId = rootEnvironment._id;
    const environment = await models.environment.create({
      parentId,
      isPrivate,
    });
    await this._load(workspace, environment);
  }

  async _handleShowEnvironment(environment: Environment) {
    // Don't allow switching if the current one has errors
    if (this.environmentEditorRef && !this.environmentEditorRef.isValid()) {
      return;
    }

    if (environment === this._getActiveEnvironment()) {
      return;
    }

    const { workspace } = this.state;
    await this._load(workspace, environment);
  }

  async _handleDuplicateEnvironment(environment: Environment) {
    const { workspace } = this.state;
    const newEnvironment = await models.environment.duplicate(environment);
    await this._load(workspace, newEnvironment);
  }

  async _handleDeleteEnvironment(environment: Environment) {
    const { handleChangeEnvironment, activeEnvironmentId } = this.props;
    const { rootEnvironment, workspace } = this.state;

    // Don't delete the root environment
    if (environment === rootEnvironment) {
      return;
    }

    // Unset active environment if it's being deleted
    if (activeEnvironmentId === environment._id) {
      await handleChangeEnvironment(null);
    }

    // Delete the current one
    await models.environment.remove(environment);
    await this._load(workspace, rootEnvironment);
  }

  async _updateEnvironment(
    environment: Environment,
    patch: Partial<Environment>,
    refresh = true,
  ) {
    const { workspace } = this.state;
    // NOTE: Fetch the environment first because it might not be up to date.
    // For example, editing the body updates silently.
    const realEnvironment = await models.environment.getById(environment._id);

    if (!realEnvironment) {
      return;
    }

    await models.environment.update(realEnvironment, patch);

    if (refresh) {
      await this._load(workspace);
    }
  }

  async _handleChangeEnvironmentName(environment: Environment, name: string) {
    await this._updateEnvironment(environment, {
      name,
    });
  }

  _handleChangeEnvironmentColor(environment: Environment | null, color: string | null) {
    if (this.colorChangeTimeout !== null) {
      clearTimeout(this.colorChangeTimeout);
    }
    this.colorChangeTimeout = setTimeout(async () => {
      // @ts-expect-error -- TSCONVERSION environment can be null
      await this._updateEnvironment(environment, {
        color,
      });
    }, DEBOUNCE_MILLIS);
  }

  _didChange() {
    this._saveChanges();

    // Call this last in case component unmounted
    const isValid = this.environmentEditorRef ? this.environmentEditorRef.isValid() : false;

    if (this.state.isValid !== isValid) {
      this.setState({
        isValid,
      });
    }
  }

  _getActiveEnvironment(): Environment | null {
    const { selectedEnvironmentId, subEnvironments, rootEnvironment } = this.state;

    if (rootEnvironment && rootEnvironment._id === selectedEnvironmentId) {
      return rootEnvironment;
    } else {
      return subEnvironments.find(e => e._id === selectedEnvironmentId) || null;
    }
  }

  _handleUnsetColor(environment: Environment) {
    this._handleChangeEnvironmentColor(environment, null);
  }

  componentDidMount() {
    db.onChange(async changes => {
      const { selectedEnvironmentId } = this.state;

      for (const change of changes) {
        const [, doc, fromSync] = change;

        // Force an editor refresh if any changes from sync come in
        if (doc._id === selectedEnvironmentId && fromSync) {
          this.editorKey = doc.modified;
          await this._load(this.state.workspace);
        }
      }
    });
  }

  async _handleSortEnd(results: {
    oldIndex: number;
    newIndex: number;
    collection: Array<Environment>;
  }) {
    const { oldIndex, newIndex } = results;

    if (newIndex === oldIndex) {
      return;
    }

    const { subEnvironments } = this.state;
    const newSubEnvironments = arrayMove(subEnvironments, oldIndex, newIndex);
    this.setState({
      subEnvironments: newSubEnvironments,
    });
    // Do this last so we don't block the sorting
    db.bufferChanges();

    for (let i = 0; i < newSubEnvironments.length; i++) {
      const environment = newSubEnvironments[i];
      await this._updateEnvironment(
        environment,
        {
          metaSortKey: i,
        },
        false,
      );
    }

    db.flushChanges();
  }

  async _handleClickColorChange(environment: Environment) {
    const color = environment.color || '#7d69cb';

    if (!environment.color) {
      await this._handleChangeEnvironmentColor(environment, color);
    }

    this.environmentColorInputRef?.click();
  }

  _handleInputColorChange(event: FormEvent<HTMLInputElement>) {
    this._handleChangeEnvironmentColor(
      this._getActiveEnvironment(),
      // @ts-expect-error -- TSCONVERSION what? apparently value doesn't exist on the target
      event.target && event.target.value,
    );
  }

  _saveChanges() {
    // Only save if it's valid
    if (!this.environmentEditorRef || !this.environmentEditorRef.isValid()) {
      return;
    }

    let patch;

    try {
      const data = this.environmentEditorRef.getValue();
      patch = {
        data: data && data.object,
        dataPropertyOrder: data && data.propertyOrder,
      };
    } catch (err) {
      // Invalid JSON probably
      return;
    }

    const activeEnvironment = this._getActiveEnvironment();

    if (activeEnvironment) {
      if (this.saveTimeout !== null) {
        clearTimeout(this.saveTimeout);
      }
      this.saveTimeout = setTimeout(async () => {
        await this._updateEnvironment(activeEnvironment, patch);
      }, DEBOUNCE_MILLIS * 4);
    }
  }

  render() {
    const {
      editorFontSize,
      editorIndentSize,
      editorKeyMap,
      lineWrapping,
      render,
      getRenderContext,
      nunjucksPowerUserMode,
      isVariableUncovered,
    } = this.props;
    const { subEnvironments, rootEnvironment, isValid } = this.state;

    const activeEnvironment = this._getActiveEnvironment();

    const environmentInfo = {
      object: activeEnvironment ? activeEnvironment.data : {},
      propertyOrder: activeEnvironment && activeEnvironment.dataPropertyOrder,
    };
    return (
      <Modal ref={this._setModalRef} wide tall {...this.props}>
        <ModalHeader>Manage Environments</ModalHeader>
        <ModalBody noScroll className="env-modal">
          <div className="env-modal__sidebar">
            <li
              className={classnames('env-modal__sidebar-root-item', {
                'env-modal__sidebar-item--active': activeEnvironment === rootEnvironment,
              })}>
              <Button onClick={this._handleShowEnvironment} value={rootEnvironment}>
                {ROOT_ENVIRONMENT_NAME}
                <HelpTooltip className="space-left">
                  The variables in this environment are always available, regardless of which
                  sub-environment is active. Useful for storing default or fallback values.
                </HelpTooltip>
              </Button>
            </li>
            <div className="pad env-modal__sidebar-heading">
              <h3 className="no-margin">Sub Environments</h3>
              <Dropdown right>
                <DropdownButton>
                  <i className="fa fa-plus-circle" />
                  <i className="fa fa-caret-down" />
                </DropdownButton>
                <DropdownItem onClick={this._handleAddEnvironment} value={false}>
                  <i className="fa fa-eye" /> Environment
                </DropdownItem>
                <DropdownItem
                  onClick={this._handleAddEnvironment}
                  value={true}
                  title="Environment will not be exported or synced">
                  <i className="fa fa-eye-slash" /> Private Environment
                </DropdownItem>
              </Dropdown>
            </div>
            <SidebarList
              environments={subEnvironments}
              activeEnvironment={activeEnvironment}
              showEnvironment={this._handleShowEnvironment}
              changeEnvironmentName={this._handleChangeEnvironmentName}
              onSortEnd={this._handleSortEnd}
              helperClass="env-modal__sidebar-item--dragging"
              transitionDuration={0}
              useWindowAsScrollContainer={false}
            />
          </div>
          <div className="env-modal__main">
            <div className="env-modal__main__header">
              <h1>
                {rootEnvironment === activeEnvironment ? (
                  ROOT_ENVIRONMENT_NAME
                ) : (
                  <Editable
                    singleClick
                    className="wide"
                    onSubmit={name =>
                      activeEnvironment &&
                      // @ts-expect-error -- TSCONVERSION only set name if defined
                      this._handleChangeEnvironmentName(activeEnvironment, name)
                    }
                    value={activeEnvironment ? activeEnvironment.name : ''}
                  />
                )}
              </h1>

              {activeEnvironment && rootEnvironment !== activeEnvironment ? (
                <Fragment>
                  <input
                    className="hidden"
                    type="color"
                    value={activeEnvironment.color || undefined}
                    ref={this._setInputColorRef}
                    onInput={this._handleInputColorChange}
                  />

                  <Dropdown className="space-right" right>
                    <DropdownButton className="btn btn--clicky">
                      {activeEnvironment.color && (
                        <i
                          className="fa fa-circle space-right"
                          style={{
                            color: activeEnvironment.color,
                          }}
                        />
                      )}
                      Color <i className="fa fa-caret-down" />
                    </DropdownButton>

                    <DropdownItem value={activeEnvironment} onClick={this._handleClickColorChange}>
                      <i
                        className="fa fa-circle"
                        style={{
                          // @ts-expect-error -- TSCONVERSION don't set color if undefined
                          color: activeEnvironment.color,
                        }}
                      />
                      {activeEnvironment.color ? 'Change Color' : 'Assign Color'}
                    </DropdownItem>

                    <DropdownItem
                      value={activeEnvironment}
                      onClick={this._handleUnsetColor}
                      disabled={!activeEnvironment.color}>
                      <i className="fa fa-minus-circle" />
                      Unset Color
                    </DropdownItem>
                  </Dropdown>

                  <Button
                    value={activeEnvironment}
                    onClick={this._handleDuplicateEnvironment}
                    className="btn btn--clicky space-right">
                    <i className="fa fa-copy" /> Duplicate
                  </Button>

                  <PromptButton
                    value={activeEnvironment}
                    onClick={this._handleDeleteEnvironment}
                    className="btn btn--clicky">
                    <i className="fa fa-trash-o" />
                  </PromptButton>
                </Fragment>
              ) : null}
            </div>
            <div className="env-modal__editor">
              <EnvironmentEditor
                editorFontSize={editorFontSize}
                editorIndentSize={editorIndentSize}
                editorKeyMap={editorKeyMap}
                lineWrapping={lineWrapping}
                ref={this._setEditorRef}
                key={`${this.editorKey}::${activeEnvironment ? activeEnvironment._id : 'n/a'}`}
                environmentInfo={environmentInfo}
                didChange={this._didChange}
                render={render}
                getRenderContext={getRenderContext}
                nunjucksPowerUserMode={nunjucksPowerUserMode}
                isVariableUncovered={isVariableUncovered}
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <div className="margin-left italic txt-sm tall">
            * Environment data can be used for&nbsp;
            <Link href={docsTemplateTags}>Nunjucks Templating</Link> in your requests
          </div>
          <button className="btn" disabled={!isValid} onClick={this.hide}>
            Done
          </button>
        </ModalFooter>
      </Modal>
    );
  }
}

export default WorkspaceEnvironmentsEditModal;
