/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./styles.css";

import * as DataStore from "@api/DataStore";
import { showNotice } from "@api/Notices";
import { Settings, useSettings } from "@api/Settings";
import { classNameFactory } from "@api/Styles";
import { CogWheel, FavouriteIcon, InfoIcon } from "@components/Icons";
import PluginModal from "@components/PluginSettings/PluginModal";
import { AddonCard } from "@components/VencordSettings/AddonCard";
import { SettingsTab } from "@components/VencordSettings/shared";
import { ChangeList } from "@utils/ChangeList";
import { proxyLazy } from "@utils/lazy";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import { classes, isObjectEmpty } from "@utils/misc";
import { openModalLazy } from "@utils/modal";
import { useAwaiter } from "@utils/react";
import { Plugin } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Alerts, Button, Card, Forms, lodash, Parser, React, Select, Text, TextInput, Toasts, Tooltip } from "@webpack/common";

import Plugins from "~plugins";

// Avoid circular dependency
const { startDependenciesRecursive, startPlugin, stopPlugin } = proxyLazy(() => require("../../plugins"));

const cl = classNameFactory("vc-plugins-");
const logger = new Logger("PluginSettings", "#a6d189");

const InputStyles = findByPropsLazy("inputDefault", "inputWrapper");
const ButtonClasses = findByPropsLazy("button", "disabled", "enabled");


function showErrorToast(message: string) {
    Toasts.show({
        message,
        type: Toasts.Type.FAILURE,
        id: Toasts.genId(),
        options: {
            position: Toasts.Position.BOTTOM
        }
    });
}

function ReloadRequiredCard({ required }: { required: boolean; }) {
    return (
        <Card className={cl("info-card", { "restart-card": required })}>
            {required ? (
                <>
                    <Forms.FormTitle tag="h5">Restart required!</Forms.FormTitle>
                    <Forms.FormText className={cl("dep-text")}>
                        Restart now to apply new plugins and their settings
                    </Forms.FormText>
                    <Button color={Button.Colors.YELLOW} onClick={() => location.reload()}>
                        Restart
                    </Button>
                </>
            ) : (
                <>
                    <Forms.FormTitle tag="h5">Plugin Management</Forms.FormTitle>
                    <Forms.FormText>Press the cog wheel or info icon to get more info on a plugin</Forms.FormText>
                    <Forms.FormText>Plugins with a cog wheel have settings you can modify!</Forms.FormText>
                </>
            )}
        </Card>
    );
}

interface PluginCardProps extends React.HTMLProps<HTMLDivElement> {
    plugin: Plugin;
    disabled: boolean;
    onRestartNeeded(name: string): void;
    isNew?: boolean;
}

export function PluginCard({ plugin, disabled, onRestartNeeded, onMouseEnter, onMouseLeave, isNew }: PluginCardProps) {
    const settings = Settings.plugins[plugin.name];

    const isEnabled = () => settings.enabled ?? false;

    function openModal() {
        openModalLazy(async () => {
            return modalProps => {
                return <PluginModal {...modalProps} plugin={plugin} onRestartNeeded={() => onRestartNeeded(plugin.name)} />;
            };
        });
    }

    function toggleEnabled() {
        const wasEnabled = isEnabled();

        // If we're enabling a plugin, make sure all deps are enabled recursively.
        if (!wasEnabled) {
            const { restartNeeded, failures } = startDependenciesRecursive(plugin);
            if (failures.length) {
                logger.error(`Failed to start dependencies for ${plugin.name}: ${failures.join(", ")}`);
                showNotice("Failed to start dependencies: " + failures.join(", "), "Close", () => null);
                return;
            } else if (restartNeeded) {
                // If any dependencies have patches, don't start the plugin yet.
                settings.enabled = true;
                onRestartNeeded(plugin.name);
                return;
            }
        }

        // if the plugin has patches, dont use stopPlugin/startPlugin. Wait for restart to apply changes.
        if (plugin.patches?.length) {
            settings.enabled = !wasEnabled;
            onRestartNeeded(plugin.name);
            return;
        }

        // If the plugin is enabled, but hasn't been started, then we can just toggle it off.
        if (wasEnabled && !plugin.started) {
            settings.enabled = !wasEnabled;
            return;
        }

        const result = wasEnabled ? stopPlugin(plugin) : startPlugin(plugin);

        if (!result) {
            settings.enabled = false;

            const msg = `Error while ${wasEnabled ? "stopping" : "starting"} plugin ${plugin.name}`;
            logger.error(msg);
            showErrorToast(msg);
            return;
        }

        settings.enabled = !wasEnabled;
    }

    function favouritePlugin() {
        settings.favourited = !settings.favourited;
    }

    function isPluginFavourited() {
        return settings.favourited;
    }


    return (
        <AddonCard
            name={plugin.name}
            description={plugin.description}
            isNew={isNew}
            enabled={isEnabled()}
            setEnabled={toggleEnabled}
            disabled={disabled}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            infoButton={
                <button role="switch" onClick={() => openModal()} className={classes(ButtonClasses.button, cl("info-button"))}>
                    {plugin.options && !isObjectEmpty(plugin.options)
                        ? <CogWheel />
                        : <InfoIcon />}
                </button>
            }
            favButton={
                <button role="switch" onClick={() => favouritePlugin()} className={classes(ButtonClasses.button, cl("pin-button"))}>
                    <FavouriteIcon isFavourited={isPluginFavourited()}></FavouriteIcon>
                </button>
            }
        />
    );
}

const enum SearchStatus {
    ALL,
    ENABLED,
    DISABLED,
    NEW
}

export default function PluginSettings() {
    const settings = useSettings();
    const changes = React.useMemo(() => new ChangeList<string>(), []);

    React.useEffect(() => {
        return () => void (changes.hasChanges && Alerts.show({
            title: "Restart required",
            body: (
                <>
                    <p>The following plugins require a restart:</p>
                    <div>{changes.map((s, i) => (
                        <>
                            {i > 0 && ", "}
                            {Parser.parse("`" + s + "`")}
                        </>
                    ))}</div>
                </>
            ),
            confirmText: "Restart now",
            cancelText: "Later!",
            onConfirm: () => location.reload()
        }));
    }, []);

    const depMap = React.useMemo(() => {
        const o = {} as Record<string, string[]>;
        for (const plugin in Plugins) {
            const deps = Plugins[plugin].dependencies;
            if (deps) {
                for (const dep of deps) {
                    o[dep] ??= [];
                    o[dep].push(plugin);
                }
            }
        }
        return o;
    }, []);

    const sortedPlugins = React.useMemo(() => Object.values(Plugins)
        .sort((a, b) => a.name.localeCompare(b.name)), []);

    const [searchValue, setSearchValue] = React.useState({ value: "", status: (SearchStatus.ALL) });

    const onSearch = (query: string) => setSearchValue(prev => ({ ...prev, value: query }));
    const onStatusChange = (status: SearchStatus) => setSearchValue(prev => ({ ...prev, status }));

    const pluginFilter = (plugin: typeof Plugins[keyof typeof Plugins], favourite : boolean) => {
        const enabled = settings.plugins[plugin.name]?.enabled;
        const v = searchValue.value.toLowerCase();
        const matchesSearch =
        plugin.name.toLowerCase().includes(v) ||
        plugin.description.toLowerCase().includes(v) ||
        plugin.tags?.some(t => t.toLowerCase().includes(v));
        const favTrue = settings.plugins[plugin.name]?.favourited;

        // return values
        const returnValueEnabled = enabled && matchesSearch;
        const returnValueDisabled = !enabled && matchesSearch;
        const returnValueNew = newPlugins?.includes(plugin.name) && matchesSearch;
        const returnValueAll = matchesSearch;

        switch (searchValue.status) {
            case SearchStatus.ALL:
                return favourite ? (returnValueAll && favTrue) : returnValueAll;
            case SearchStatus.DISABLED:
                return favourite ? (returnValueDisabled && favTrue) : returnValueDisabled;
            case SearchStatus.ENABLED:
                return favourite ? (returnValueEnabled && favTrue) : returnValueEnabled;
            case SearchStatus.NEW:
                return favourite ? (returnValueNew && favTrue) : returnValueNew;
        }

    };

    const [newPlugins] = useAwaiter(() => DataStore.get("Vencord_existingPlugins").then((cachedPlugins: Record<string, number> | undefined) => {
        const now = Date.now() / 1000;
        const existingTimestamps: Record<string, number> = {};
        const sortedPluginNames = Object.values(sortedPlugins).map(plugin => plugin.name);

        const newPlugins: string[] = [];
        for (const { name: p } of sortedPlugins) {
            const time = existingTimestamps[p] = cachedPlugins?.[p] ?? now;
            if ((time + 60 * 60 * 24 * 2) > now) {
                newPlugins.push(p);
            }
        }
        DataStore.set("Vencord_existingPlugins", existingTimestamps);

        return lodash.isEqual(newPlugins, sortedPluginNames) ? [] : newPlugins;
    }));

    function pluginFilterAll(plugins, favourite)
    {
        for (const plugin of plugins)
        {
            if(pluginFilter(plugin,favourite))
            {
                return true;
            }
        }
        return false;
    }

    function PluginList(props) {
        type P = JSX.Element | JSX.Element[];
        let plugins: P, requiredPlugins: P;
        if (sortedPlugins?.length) {
            plugins = [];
            requiredPlugins = [];
            for (const p of sortedPlugins) {
                if (!p.options && p.name.endsWith("API") && searchValue.value !== "API")
                    continue;

                if (!pluginFilter(p, props.favourited)) continue;

                const isRequired = p.required || depMap[p.name]?.some(d => settings.plugins[d].enabled);

                if (isRequired) {
                    const tooltipText = p.required
                        ? "This plugin is required for Vencord to function."
                        : makeDependencyList(depMap[p.name]?.filter(d => settings.plugins[d].enabled));

                    requiredPlugins.push(
                        <Tooltip text={tooltipText} key={p.name}>
                            {({ onMouseLeave, onMouseEnter }) => (
                                <PluginCard
                                    onMouseLeave={onMouseLeave}
                                    onMouseEnter={onMouseEnter}
                                    onRestartNeeded={name => changes.handleChange(name)}
                                    disabled={true}
                                    plugin={p}
                                />
                            )}
                        </Tooltip>
                    );
                } else if (props.favourited && settings.plugins[p.name].favourited || !props.favourited && !settings.plugins[p.name].favourited){
                    plugins.push(
                        <PluginCard
                            onRestartNeeded={name => changes.handleChange(name)}
                            disabled={false}
                            plugin={p}
                            isNew={newPlugins?.includes(p.name)}
                            key={p.name}
                        />
                    );
                }
            }
        } else {
            plugins = [];
            requiredPlugins = [];
        }

        // Display a message if there are no plugins meeting the search criteria
        if (plugins.length === 0 && requiredPlugins.length === 0) {
            plugins = <Text variant="text-md/normal">No plugins meet search criteria.</Text>;
        }

        return (
            <>
                {props.required && requiredPlugins}
                {!props.required && plugins}
            </>
        );
    }

    const isAnyPluginFavorited = pluginFilterAll(sortedPlugins, true);

    const options = [
        { label: "All", value: SearchStatus.ALL },
        { label: "Enabled", value: SearchStatus.ENABLED },
        { label: "Disabled", value: SearchStatus.DISABLED },
    ];
    if(settings.newPlugins) { options.push({ label: "New", value: SearchStatus.NEW }); }

    return (
        <SettingsTab title="Plugins">
            <ReloadRequiredCard required={changes.hasChanges} />

            {isAnyPluginFavorited &&
                <>
                    <Forms.FormTitle className={Margins.top20}>Favourite Plugins</Forms.FormTitle>
                    <div className={cl("grid")}>
                        <PluginList required={false} favourited={true}></PluginList>
                    </div>
                </>

            }

            <Forms.FormTitle tag="h5" className={classes(Margins.top20, Margins.bottom8)}>
                Filters
            </Forms.FormTitle>


            <div className={cl("filter-controls")}>
                <TextInput autoFocus value={searchValue.value} placeholder="Search for a plugin..." onChange={onSearch} className={Margins.bottom20} />
                <div className={InputStyles.inputWrapper}>
                    <Select
                        className={InputStyles.inputDefault}
                        serialize={String}
                        options={options}
                        select={onStatusChange}
                        isSelected={v => v === searchValue.status}
                        closeOnSelect={true}
                    />
                </div>
            </div>

            <Forms.FormTitle className={Margins.top20}>Plugins</Forms.FormTitle>
            <div className={cl("grid")}>
                <PluginList required={false} favourited={false}></PluginList>
            </div>

            <Forms.FormDivider className={Margins.top20} />

            <Forms.FormTitle tag="h5" className={classes(Margins.top20, Margins.bottom8)}>
                Required Plugins
            </Forms.FormTitle>
            <div className={cl("grid")}>
                <PluginList required={true} favourite={false}></PluginList>
            </div>
        </SettingsTab >
    );
}

function makeDependencyList(deps: string[]) {
    return (
        <React.Fragment>
            <Forms.FormText>This plugin is required by:</Forms.FormText>
            {deps.map((dep: string) => <Forms.FormText className={cl("dep-text")}>{dep}</Forms.FormText>)}
        </React.Fragment>
    );
}
